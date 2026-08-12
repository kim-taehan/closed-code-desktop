import { ipcMain, type BrowserWindow } from 'electron'
import { Channel, type ProjectScoped } from '../../shared/ipc/channels'
import type {
  PtyDetachPayload,
  PtyInputPayload,
  PtyOpenResult,
  PtyResizePayload,
} from '../../shared/ipc/ptyPayloads'
import { isSendableSize, PtyClient } from './client'
import { PtySocket } from './socket'

// 셸 드로어의 IPC 배선과 **프로젝트별 pty 수명**. 만든 자리가 정리하는 자리다.
//
// **렌더러가 WS 를 직접 열지 않는 이유**가 이 계층의 존재 이유다.
//   1. `index.html` 의 CSP 가 `default-src 'self'` 이고 `connect-src` 가 따로 없다.
//      포장판의 오리진은 `file://` 이라 127.0.0.1 로 나가는 WS 가 차단된다.
//      터미널 칸 하나 때문에 앱 전체 CSP 를 여는 것은 맞바꿀 만한 거래가 아니다.
//   2. 서버 주소·비밀번호 해석 규칙이 main 에 있다 (`opencode/endpoint.ts`·`settings`).
//      렌더러에 주소를 흘리면 그 규칙이 두 벌이 된다.
//
// **드로어는 활성 프로젝트의 것이다.** 렌더러는 projectId 를 보내지 않고, 여기서 활성
// 프로젝트로 푼다 — 세션 핸들러(`sessionHandlers.ts`)와 같은 규칙이다. 나가는 프레임에는
// 겉봉을 씌워, 프로젝트를 옮기는 순간 도착한 이전 프로젝트의 출력이 화면에 섞이지 않게 한다.
//
// ## cwd 는 **프로젝트 루트**다 (사용자 결정)
//
// 셸을 띄우는 곳도, pty 를 조회하는 곳도 전부 `ProjectRecord.root` 하나다. 루트의 정본은
// `electron/projects/projectRegistry.ts` 이고 여기서 새로 정의하지 않는다 —
// main.ts 가 `registry.active` 를 그대로 넘긴다.
//
// "마지막으로 본 파일의 폴더" 는 채택하지 않았다: cwd 가 조용히 바뀌면 방금 친 명령과
// 다른 곳에서 다음 명령이 돌고, 터미널에는 그 사실이 안 보인다.
//
// **이 결정 덕에 pty 격리가 프로젝트 경계와 정확히 일치한다.** 실측(1.17.18):
// `GET /api/pty?location[directory]=A` 는 A 의 pty 만 주고, 틀린 디렉토리로 하나를 물으면
// **404** 다. 즉 아래 `open()` 의 "이미 있으면 되찾는다" 가 남의 프로젝트 셸을 집어 올
// 수 없다 — 목록 자체가 이 프로젝트 것뿐이다. 이 성질이 깨지면 되찾기가 곧 유출이 되므로,
// opencode 를 올릴 때 `electron/pty/isolation.test.ts` 를 먼저 본다.

/** 우리가 만든 pty 를 알아보는 이름. 앱을 껐다 켜도 이걸로 되찾는다. */
export const DRAWER_TITLE = 'open-code-desktop 드로어'

/** FitAddon 은 창을 끌 때마다 부른다 — 매번 HTTP 를 때리지 않게 묶는다. */
const RESIZE_DEBOUNCE_MS = 120

const HANDLED = [Channel.PTY_OPEN, Channel.PTY_RESIZE]

interface DrawerState {
  ptyId: string
  root: string
  socket: PtySocket
  size: { rows: number; cols: number } | null
  resizeTimer: NodeJS.Timeout | null
}

export interface PtyDrawerOptions {
  window: BrowserWindow
  /** 지금 앞에 나와 있는 프로젝트. 없으면 드로어를 열 수 없다. */
  activeProject: () => { id: string; root: string } | null
  /** 붙어 있는 opencode 서버 주소. 설정에서 바뀔 수 있어 매번 읽는다. */
  opencodeUrl: () => Promise<string>
  password?: string
}

export class PtyDrawerBridge {
  private readonly drawers = new Map<string, DrawerState>()

  private readonly onInput = (_event: unknown, payload: PtyInputPayload): void => this.write(payload)
  private readonly onDetach = (_event: unknown, payload: PtyDetachPayload): void =>
    this.detach(payload)

  constructor(private readonly options: PtyDrawerOptions) {}

  register(): void {
    ipcMain.handle(Channel.PTY_OPEN, () => this.open())
    ipcMain.handle(Channel.PTY_RESIZE, (_event, payload: PtyResizePayload) => this.resize(payload))
    // 키 입력은 `on` 이지 `handle` 이 아니다 — 글자마다 도는 자리라 왕복을 기다리면
    // 타이핑이 IPC 지연만큼 느려진다 (`extensionActiveFile.ts` 와 같은 판단).
    // **`removeAllListeners` 가 아니라 이 참조로 푼다** — 채널의 다른 청자까지 걷어내지 않게.
    ipcMain.on(Channel.PTY_INPUT, this.onInput)
    ipcMain.on(Channel.PTY_DETACH, this.onDetach)
  }

  /**
   * 드로어를 편다. 이미 붙어 있으면 아무 일도 안 한다.
   *
   * 서버에 이미 우리 pty 가 있으면 **되찾는다** — 앱을 껐다 켜도 그 셸과 스크롤백이 그대로다
   * (`cursor=0` 으로 붙으면 서버가 앞부분을 다시 보내 준다, 실측).
   */
  private async open(): Promise<PtyOpenResult> {
    const project = this.options.activeProject()
    if (project === null) return { ok: false, error: '열려 있는 프로젝트가 없습니다' }
    if (this.drawers.has(project.id)) return { ok: true }

    try {
      const client = await this.clientFor()
      const existing = (await client.list(project.root)).find(
        (pty) => pty.title === DRAWER_TITLE && pty.status === 'running',
      )
      const pty = existing ?? (await client.create(project.root, { title: DRAWER_TITLE }))
      this.attach(client, project, pty.id)
      return { ok: true }
    } catch (error) {
      // 서버가 안 떠 있으면 여기로 온다. 사유를 그대로 화면에 올린다 —
      // 빈 터미널만 보여 주면 사용자가 자기 탓으로 여긴다.
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private attach(client: PtyClient, project: { id: string; root: string }, ptyId: string): void {
    const socket = new PtySocket({
      url: client.socketUrl(project.root, ptyId),
      headers: client.headers,
    })
    const state: DrawerState = { ptyId, root: project.root, socket, size: null, resizeTimer: null }
    this.drawers.set(project.id, state)

    socket.onData((chunk) => this.push(Channel.PTY_DATA, project.id, { chunk }))
    socket.onError((error) => this.push(Channel.PTY_DATA, project.id, { chunk: `\r\n[${error.message}]\r\n` }))
    // close 는 대개 "셸이 끝났다" 다. 종료 코드는 프레임에 없어 다시 물어봐야 안다 (실측).
    socket.onClose(() => void this.reportExit(project.id, state))
    socket.open()
  }

  private async reportExit(projectId: string, state: DrawerState): Promise<void> {
    this.forget(projectId)
    const pty = await this.clientFor()
      .then((client) => client.get(state.root, state.ptyId))
      .catch(() => null)
    this.push(Channel.PTY_EXIT, projectId, { exitCode: pty?.exitCode ?? null })
  }

  private write(payload: PtyInputPayload): void {
    const state = this.current()
    // 열리기 전에 친 키는 버린다. 큐에 쌓아 두면 셸이 준비된 뒤 한꺼번에 쏟아진다.
    state?.socket.write(payload.data)
  }

  /**
   * 크기 변경. **묶어서 보낸다** — FitAddon 이 창 크기를 끄는 동안 계속 부르는데
   * 그때마다 HTTP 를 때리면 요청이 수십 개 쌓인다.
   *
   * ⚠️ **0 은 보내지 않는다** (`isSendableSize` — 왜 지금은 도달 불가인데도 두는지가 거기 있다).
   * 여기서 먼저 걸러 디바운스 타이머조차 걸지 않는다. 아래 `.catch(() => {})` 가 실패를
   * 삼키므로, 못 보낼 값이 여기까지 오면 **아무 흔적 없이 사라진다.**
   */
  private resize(payload: PtyResizePayload): void {
    if (!isSendableSize(payload)) return
    const project = this.options.activeProject()
    const state = project === null ? undefined : this.drawers.get(project.id)
    if (state === undefined) return
    if (state.size?.rows === payload.rows && state.size.cols === payload.cols) return
    state.size = { rows: payload.rows, cols: payload.cols }

    if (state.resizeTimer !== null) clearTimeout(state.resizeTimer)
    state.resizeTimer = setTimeout(() => {
      state.resizeTimer = null
      const size = state.size
      if (size === null) return
      void this.clientFor()
        .then((client) => client.resize(state.root, state.ptyId, size))
        // 크기 조절 실패로 드로어를 죽이지 않는다 — 글자는 계속 흐른다
        .catch(() => {})
    }, RESIZE_DEBOUNCE_MS)
  }

  /**
   * 그 프로젝트의 드로어에서 손을 뗀다. **pty 는 죽이지 않는다** — 다시 펴면 그 셸이
   * 스크롤백째 돌아와야 한다. 진짜로 없애는 것은 프로젝트를 닫을 때뿐이다 (`closeProject`).
   *
   * ⚠️ **⌘↑ 로 접을 때는 안 온다.** 접기는 `display:none` 일 뿐 언마운트가 아니라
   * 정리 함수가 안 돈다 (`ShellDrawer` — 내리면 그리던 화면이 날아간다). 접힌 동안에도
   * 소켓은 붙어 있고, 그게 맞다: 그동안 흘러간 출력이 다시 펼 때 화면에 남아 있어야 한다.
   *
   * 실제로 오는 경로는 **프로젝트를 옮길 때** 하나뿐이다. 그래서 **활성 프로젝트로 풀지
   * 않는다** — 그 시점에 활성은 이미 도착한 쪽이라, 그러면 떠나온 것 대신 도착한 것을
   * 정리한다. 떠나는 쪽이 신원을 실어 보낸다 (`PtyDetachPayload`).
   */
  private detach(payload: PtyDetachPayload): void {
    if (typeof payload?.projectId !== 'string') return
    this.forget(payload.projectId)
  }

  /** 탭을 닫았다 — 셸도 함께 거둔다. 안 그러면 서버에 죽은 셸이 쌓인다. */
  async closeProject(projectId: string): Promise<void> {
    const state = this.drawers.get(projectId)
    if (state === undefined) return
    this.forget(projectId)
    await this.clientFor()
      .then((client) => client.remove(state.root, state.ptyId))
      .catch(() => {})
  }

  async dispose(): Promise<void> {
    for (const projectId of [...this.drawers.keys()]) this.forget(projectId)
    for (const channel of HANDLED) ipcMain.removeHandler(channel)
    ipcMain.removeListener(Channel.PTY_INPUT, this.onInput)
    ipcMain.removeListener(Channel.PTY_DETACH, this.onDetach)
  }

  private current(): DrawerState | undefined {
    const project = this.options.activeProject()
    return project === null ? undefined : this.drawers.get(project.id)
  }

  /** 소켓을 접고 표에서 지운다. 서버 쪽 pty 는 그대로 둔다. */
  private forget(projectId: string): void {
    const state = this.drawers.get(projectId)
    if (state === undefined) return
    this.drawers.delete(projectId)
    if (state.resizeTimer !== null) clearTimeout(state.resizeTimer)
    state.socket.close()
  }

  private async clientFor(): Promise<PtyClient> {
    return new PtyClient({
      baseUrl: await this.options.opencodeUrl(),
      ...(this.options.password !== undefined ? { password: this.options.password } : {}),
    })
  }

  private push(channel: string, projectId: string, payload: unknown): void {
    if (this.options.window.isDestroyed()) return
    const scoped: ProjectScoped<unknown> = { projectId, payload }
    this.options.window.webContents.send(channel, scoped)
  }
}
