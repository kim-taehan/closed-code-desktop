import { ipcMain, type BrowserWindow } from 'electron'
import { Channel, type ProjectScoped } from '../../shared/ipc/channels'
import type {
  PtyClosePayload,
  PtyDetachPayload,
  PtyInputPayload,
  PtyOpenPayload,
  PtyOpenResult,
  PtyResizePayload,
} from '../../shared/ipc/ptyPayloads'
import { PtyClient } from './client'
import type { OutputSnapshot } from './outputBuffer'
import { PendingWrites } from './pendingWrites'
import { PtyPool, SHELL_PANE } from './ptyPool'

// 셸 드로어의 IPC 배선. **수명과 표는 `ptyPool.ts` 가 쥔다** — 여기는 채널과 겉봉뿐이다.
//
// **렌더러가 WS 를 직접 열지 않는 이유**가 이 계층의 존재 이유다.
//   1. `index.html` 의 CSP 가 `default-src 'self'` 이고 `connect-src` 가 따로 없다.
//      포장판의 오리진은 `file://` 이라 127.0.0.1 로 나가는 WS 가 차단된다.
//      터미널 칸 하나 때문에 앱 전체 CSP 를 여는 것은 맞바꿀 만한 거래가 아니다.
//   2. 서버 주소·비밀번호 해석 규칙이 main 에 있다 (`opencode/endpoint.ts`·`settings`).
//      렌더러에 주소를 흘리면 그 규칙이 두 벌이 된다.
//
// **드로어는 활성 프로젝트의 것이다.** 렌더러는 들어오는 요청에 projectId 를 싣지 않고,
// 여기서 활성 프로젝트로 푼다 — 세션 핸들러(`sessionHandlers.ts`)와 같은 규칙이다. 나가는
// 프레임에는 겉봉을 씌워, 프로젝트를 옮기는 순간 도착한 이전 프로젝트의 출력이 화면에
// 섞이지 않게 한다. **떠나는 프레임(`detach`·`close`)만 예외로 신원을 싣는다** —
// 그 시점의 활성은 이미 도착한 쪽이라 여기서 풀면 엉뚱한 것을 정리한다 (`PtyDetachPayload`).
//
// 프레임마다 `name` 이 함께 온다. **한 프로젝트에 칸이 여럿**이고 탭 하나가 pty 하나다
// (`ptyPool.ts` 머리말 — 왜 하나로는 안 되는지가 거기 있다).
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
// **404** 다. 즉 `PtyPool.open` 의 "이미 있으면 되찾는다" 가 남의 프로젝트 셸을 집어 올
// 수 없다 — 목록 자체가 이 프로젝트 것뿐이다. 이 성질이 깨지면 되찾기가 곧 유출이 되므로,
// opencode 를 올릴 때 `electron/pty/isolation.test.ts` 를 먼저 본다.

export { DRAWER_TITLE, SHELL_PANE } from './ptyPool'

/**
 * 채우기 전에 줄을 비우는 바이트 — Ctrl+E(줄 끝으로) + Ctrl+U(줄 지우기).
 *
 * 실측(zsh, opencode 1.18.18 pty): 쳐 둔 글자가 있는 채로 이 둘을 보내면 셸이 지운 만큼
 * 되감아 그린다(`ESC[11D` + 공백 11 + `ESC[11D`). **Ctrl+U 하나로는 모자란다** —
 * bash 의 그것은 커서 **앞쪽만** 지운다(`unix-line-discard`). 끝으로 옮기고 지워야 둘이 같다.
 *
 * **뒤에 이어 붙이지 않는다.** 모델에게 돌려주는 문장은 "이 명령을 채웠다" 인데, 사용자가
 * 쳐 두던 글자에 이어 붙으면 화면의 줄은 그 문장과 **다른 명령**이 된다. 보고 엔터를 치는
 * 사람에게는 그쪽이 훨씬 위험하다 — 쓰던 글자를 잃는 것과 맞바꿨다.
 */
const CLEAR_LINE = '\x05\x15'

const HANDLED = [Channel.PTY_OPEN, Channel.PTY_RESIZE, Channel.PTY_CLOSE]

/** `run` 의 결과. **started 가 거짓이면 이미 돌고 있던 것**이고, 우리는 아무것도 안 했다. */
export type PaneRunResult = { ok: true; started: boolean } | { ok: false; error: string }

export interface PtyDrawerOptions {
  window: BrowserWindow
  /** 지금 앞에 나와 있는 프로젝트. 없으면 드로어를 열 수 없다. */
  activeProject: () => { id: string; root: string } | null
  /**
   * **활성 프로젝트의** opencode 서버 주소. 아직 안 떴으면 null.
   *
   * 예전에는 설정에서 읽는 앱 전역 주소 하나였다(`() => Promise<string>`). 서버가
   * 프로젝트마다 갈리면서 드로어도 **그 프로젝트의 서버**에 pty 를 만든다 —
   * 다른 서버에 만들면 셸이 엉뚱한 프로젝트에서 뜬다.
   */
  opencodeUrl: () => string | null
  password?: string
}

export class PtyDrawerBridge {
  private readonly pool: PtyPool
  /**
   * 아직 못 넣은 바이트 (`pendingWrites.ts`). **칸마다 하나**다.
   *
   * 예전에는 프로젝트마다 하나였고 언제나 셸 칸으로 갔다 — 채우는 쪽(`open_terminal`)이
   * 하나뿐이었기 때문이다. `run_project` 가 들어오면서 **셸이 아닌 칸에도 맡길 것이 생겼다**
   * (설계 §3).
   */
  private readonly pending = new PendingWrites((projectId, name, bytes) =>
    this.pool.write(projectId, name, bytes),
  )

  private readonly onInput = (_event: unknown, payload: PtyInputPayload): void => this.write(payload)
  private readonly onDetach = (_event: unknown, payload: PtyDetachPayload): void =>
    this.detach(payload)

  constructor(private readonly options: PtyDrawerOptions) {
    this.pool = new PtyPool({
      clientFor: () => this.clientFor(),
      events: {
        // 맡아 둔 명령은 **여기서** 들어간다. `open()` 이 돌아온 시점은 아직 CONNECTING 이라
        // 그때 쓰면 사라진다 (`PtySocket.open` 의 실측).
        onOpen: (projectId, name) => this.pending.flush(projectId, name),
        onData: (projectId, name, chunk) => this.push(Channel.PTY_DATA, projectId, { name, chunk }),
        onExit: (projectId, name, exitCode) =>
          this.push(Channel.PTY_EXIT, projectId, { name, exitCode }),
      },
    })
  }

  register(): void {
    ipcMain.handle(Channel.PTY_OPEN, (_event, payload: PtyOpenPayload) => this.open(payload))
    ipcMain.handle(Channel.PTY_RESIZE, (_event, payload: PtyResizePayload) => this.resize(payload))
    ipcMain.handle(Channel.PTY_CLOSE, (_event, payload: PtyClosePayload) => this.close(payload))
    // 키 입력은 `on` 이지 `handle` 이 아니다 — 글자마다 도는 자리라 왕복을 기다리면
    // 타이핑이 IPC 지연만큼 느려진다 (`extensionActiveFile.ts` 와 같은 판단).
    // **`removeAllListeners` 가 아니라 이 참조로 푼다** — 채널의 다른 청자까지 걷어내지 않게.
    ipcMain.on(Channel.PTY_INPUT, this.onInput)
    ipcMain.on(Channel.PTY_DETACH, this.onDetach)
  }

  /** 그 이름의 칸을 편다. 사유는 그대로 화면에 올라간다 (`PtyOpenResult`). */
  private async open(payload: PtyOpenPayload): Promise<PtyOpenResult> {
    const project = this.options.activeProject()
    if (project === null) return { ok: false, error: '열려 있는 프로젝트가 없습니다' }
    if (typeof payload?.name !== 'string' || payload.name === '') {
      return { ok: false, error: '셸 칸 이름이 없습니다' }
    }

    try {
      await this.pool.open(project, payload.name)
      return { ok: true }
    } catch (error) {
      // 서버가 안 떠 있으면 여기로 온다. 사유를 그대로 화면에 올린다 —
      // 빈 터미널만 보여 주면 사용자가 자기 탓으로 여긴다.
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private write(payload: PtyInputPayload): void {
    const project = this.options.activeProject()
    if (project === null) return
    // 열리기 전에 친 키는 버린다. 큐에 쌓아 두면 셸이 준비된 뒤 한꺼번에 쏟아진다.
    this.pool.write(project.id, payload.name, payload.data)
  }

  private resize(payload: PtyResizePayload): void {
    const project = this.options.activeProject()
    if (project === null) return
    this.pool.resize(project.id, payload.name, payload)
  }

  /**
   * 드로어에 명령을 **채워만 둔다.** 개행을 붙이지 않으므로 실행되지 않는다 —
   * 보고 엔터를 치는 것은 사용자다 (`electron/mcp/openTerminal.ts`).
   *
   * **소켓이 아직 없거나 안 열렸으면 맡아 둔다.** 이 자리가 필요한 이유는 순서다:
   * 에이전트가 부르는 시점에 칸은 한 번도 안 펴져 있을 수 있고(`everOpened`), 그러면
   * pty 는 화면이 칸을 그린 **뒤에야** 붙는다. 그 전에 쓴 바이트는 아무 흔적 없이 사라진다.
   *
   * 맡아 둔 것은 그 프로젝트의 셸 칸이 열릴 때 들어간다. 사용자가 그 사이에 다른
   * 프로젝트로 옮겨 칸을 안 펴면 **남아 있다가 나중에 펼 때 채워진다** — 늦을 뿐
   * 엉뚱한 곳으로 가지는 않는다(키가 프로젝트다). 탭을 닫으면 함께 버린다.
   */
  fill(projectId: string, command: string): void {
    this.pending.enqueue(projectId, SHELL_PANE, CLEAR_LINE + command)
  }

  /**
   * 그 이름의 칸에서 명령을 **돌린다** (`run_project`, 설계 §3). `fill` 과 갈리는 지점이
   * 두 군데다: 칸이 셸이 아니고, **개행이 붙는다.**
   *
   * ⚠️ **이미 돌고 있으면 아무것도 하지 않는다** — `started: false` 로 그 사실만 돌려준다.
   * 개발 서버가 둘이 뜨면 뒤엣것은 포트를 못 잡고 죽거나(무슨 일인지 화면에 안 보인다),
   * 다른 포트를 잡아 사용자가 보던 주소가 조용히 어긋난다.
   *
   * **멈추거나 다시 띄우는 길은 여기 없다.** 사용자가 보고 있던 것을 없애는 행동이라
   * 사람만 한다 (설계 §3 — 탭의 ✕ 가 그 문이다).
   *
   * 신원을 활성 프로젝트와 대조한다: 칸을 그리는 것은 화면이고 화면의 드로어는 앞에 나와
   * 있는 프로젝트의 것뿐이라, 뒤에서 띄우면 **아무도 못 보는 프로세스**가 된다 — 못 보면
   * 탭의 ✕ 도 없어 멈출 방법이 사라진다.
   */
  async run(projectId: string, name: string, command: string): Promise<PaneRunResult> {
    const project = this.options.activeProject()
    if (project === null || project.id !== projectId) {
      return { ok: false, error: '이 프로젝트가 앞에 나와 있지 않습니다' }
    }

    try {
      const { reclaimed } = await this.pool.open(project, name)
      if (reclaimed) return { ok: true, started: false }
    } catch (error) {
      // 서버가 안 떴을 때가 가장 흔하다. 사유를 그대로 모델에게 올린다.
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }

    // **개행이 여기 붙는다.** `fill` 과 갈리는 지점이고, 이 한 글자가 「채워만 둔다」와
    // 「돌린다」를 가른다.
    this.pending.enqueue(projectId, name, `${command}\n`)
    return { ok: true, started: true }
  }

  /**
   * 그 칸이 붙들고 있는 지나간 출력. 없는 칸이면 null.
   *
   * **잘렸으면 잘렸다고 말한다** — `dropped`·`total` 이 함께 온다 (`outputBuffer.ts`).
   * 다음 층(`read_logs`)이 그것을 모델에게 그대로 넘긴다: 조용히 자르면 모델이 "이게 전부"
   * 로 읽는다 (이 레포의 기존 규칙 `ToolResult.truncated`, 설계 §3).
   */
  logs(projectId: string, name: string): OutputSnapshot | null {
    return this.pool.snapshot(projectId, name)
  }

  /**
   * 그 칸에서 손을 뗀다. **pty 는 죽이지 않는다** — 다시 펴면 그 셸이 스크롤백째 돌아와야 한다.
   *
   * ⚠️ **⌘↑ 로 접을 때는 안 온다.** 접기는 `display:none` 일 뿐 언마운트가 아니라
   * 정리 함수가 안 돈다 (`ShellDrawer` — 내리면 그리던 화면이 날아간다). 접힌 동안에도
   * 소켓은 붙어 있고, 그게 맞다: 그동안 흘러간 출력이 다시 펼 때 화면에 남아 있어야 한다.
   *
   * 오는 경로는 둘이다 — **프로젝트를 옮길 때**와 **탭을 닫을 때**(그쪽은 `close` 가 pty 까지
   * 지운 뒤 화면이 언마운트되며 한 번 더 온다. 이미 없는 칸이라 무해하다). 그래서 **활성
   * 프로젝트로 풀지 않는다**: 프로젝트 이동 시점의 활성은 이미 도착한 쪽이라, 그러면
   * 떠나온 것 대신 도착한 것을 정리한다. 떠나는 쪽이 신원을 실어 보낸다 (`PtyDetachPayload`).
   */
  private detach(payload: PtyDetachPayload): void {
    if (typeof payload?.projectId !== 'string' || typeof payload?.name !== 'string') return
    this.pool.detach(payload.projectId, payload.name)
  }

  /** 탭의 ✕ — **프로세스도 멈춘다.** 신원을 싣는 이유는 `detach` 와 같다. */
  private async close(payload: PtyClosePayload): Promise<void> {
    if (typeof payload?.projectId !== 'string' || typeof payload?.name !== 'string') return
    await this.pool.close(payload.projectId, payload.name)
  }

  /** 프로젝트 탭을 닫았다 — 그 프로젝트의 셸을 통째로 거둔다. 안 그러면 서버에 죽은 셸이 쌓인다. */
  async closeProject(projectId: string): Promise<void> {
    this.pending.clearProject(projectId)
    await this.pool.closeProject(projectId)
  }

  async dispose(): Promise<void> {
    for (const channel of HANDLED) ipcMain.removeHandler(channel)
    ipcMain.removeListener(Channel.PTY_INPUT, this.onInput)
    ipcMain.removeListener(Channel.PTY_DETACH, this.onDetach)
    await this.pool.dispose()
  }

  /**
   * 그 프로젝트의 서버에 붙는 클라이언트. **서버가 아직 없으면 거절한다** —
   * 빈 주소로 만들면 `http:///pty` 를 때리고 사유가 fetch 오류로 뭉개진다.
   * (거절로 내는 이유는 부르는 쪽들이 이미 실패를 그렇게 다루기 때문이다 — 드로어를
   * 여는 자리는 사유를 화면에 올리고, 크기 조절·정리는 조용히 넘긴다.)
   */
  private async clientFor(): Promise<PtyClient> {
    const baseUrl = this.options.opencodeUrl()
    if (baseUrl === null) throw new Error('이 프로젝트의 opencode 서버가 아직 뜨지 않았습니다')
    return new PtyClient({
      baseUrl,
      ...(this.options.password !== undefined ? { password: this.options.password } : {}),
    })
  }

  private push(channel: string, projectId: string, payload: unknown): void {
    if (this.options.window.isDestroyed()) return
    const scoped: ProjectScoped<unknown> = { projectId, payload }
    this.options.window.webContents.send(channel, scoped)
  }
}
