import type { PtyClient } from './client'
import { isSendableSize } from './client'
import { OutputBuffer, type OutputSnapshot } from './outputBuffer'
import { PtySocket } from './socket'

// **프로젝트마다 pty 여럿, 이름으로 관리한다.**
//
// `opencode/serverPool.ts` 가 opencode 서버에 대해 하는 일과 같은 종류다 — 표를 쥐고,
// 없으면 띄우고, 우리가 띄운 것만 거둔다. 다른 점 하나: 서버는 프로젝트당 하나지만
// pty 는 **프로젝트당 여럿**이라 키가 두 겹(projectId → name)이다.
//
// 왜 여럿이어야 하나: 예전에는 프로젝트당 하나라 개발 서버를 띄우면 셸 칸이 그대로 잠겼다.
// 실행·로그 기능이 막혀 있던 자리가 정확히 여기다 (설계 2026-08-16 §5 — "첫 단추는 화면이
// 아니라 pty 다중화다").
//
// **여기는 프로세스 조작만 한다.** 화면에 무엇을 보낼지는 `drawerBridge.ts` 가 정하고,
// 판정과 문구는 렌더러에 있다 (설계 §5 「경계」).
//
// ## 수명 규칙 — 셋이 갈린다
//
// | 언제 | 소켓 | 서버의 pty | 왜 |
// |---|---|---|---|
// | `detach` (접기·프로젝트 이동) | 접는다 | **남긴다** | 다시 펴면 스크롤백째 돌아와야 한다 (`cursor=0`) |
// | `close` (탭의 ✕) | 접는다 | **지운다** | 사용자가 "이제 필요 없다" 고 말한 것이다. 안 지우면 띄운 개발 서버가 화면에서만 사라진 채 계속 돈다 |
// | `dispose` (앱 종료) | 접는다 | **셸 칸만 남긴다** | 아래 |
//
// 앱을 끌 때 셸 칸을 남기는 것은 **되찾을 수 있기 때문**이다 — 다음 실행이 같은 이름
// (`SHELL_PANE`)으로 반드시 물어보므로 제목으로 찾아 다시 붙는다 (실측: 껐다 켜도 그 셸과
// 스크롤백이 그대로다). 그 밖의 칸은 이름을 아무도 다시 부르지 않아 **서버에 아무도 못 찾는
// 셸이 쌓인다.** 되찾을 수 없는 것만 거두는 것이 이 규칙이다.
//
// ⚠️ **우리가 만든 것만 만진다.** 표에 있는 것은 우리가 만들었거나 우리 제목으로 되찾은
// 것뿐이다 (`paneServerTitle`). 사용자가 손으로 띄운 pty 는 목록에서 이름이 안 맞아
// 걸리지 않는다 — `pidStore` 와 같은 규칙이고, 이 레포의 관통 원칙이다.
//
// ## 실측 (1.18.18, 2026-08-16) — 이 파일이 서 있는 세 가지
//
// 위 규칙은 전부 "서버가 이렇게 해 준다" 에 기대고 있어 직접 쟀다. 임시 폴더에 서버를
// 따로 띄워 확인했다:
//
// 1. **같은 디렉토리에 pty 둘이 동시에 뜬다.** `POST /api/pty` 를 두 번 하면 id 도 **pid 도
//    다른** 셸이 둘 생기고 `GET /api/pty` 가 둘 다 준다. 다중화의 전제가 여기다 —
//    서버가 디렉토리마다 하나로 접었다면 이 파일 전체가 성립하지 않는다.
// 2. **`title` 은 그대로 왕복한다** (`:` 접미사·한글 포함). 되찾기가 완전 일치로 도는
//    근거이고, `paneServerTitle` 의 접미사 규칙이 서는 자리다.
// 3. **`DELETE /api/pty/{id}` 는 그 하나만 거둔다** — 204 를 주고 그 pid 는 사라지지만
//    옆 pty 는 `running` 으로 남는다. 「탭을 닫으면 프로세스도 멈춘다」가 화면 약속이
//    아니라 실제로 서는 것이 이 줄이다.

/** 우리가 만든 pty 를 알아보는 이름. 앱을 껐다 켜도 이걸로 되찾는다. */
export const DRAWER_TITLE = 'closed-code-desktop 드로어'

/**
 * 셸 칸의 이름. 화면 쪽 정본은 `src/state/drawerTabs.ts` 이고 여기서는 **되찾기 규칙**이
 * 이 값에 걸린다 (위 표의 `dispose` 줄).
 */
export const SHELL_PANE = 'shell'

/**
 * 서버에 붙일 제목. 되찾기가 이 문자열의 완전 일치로 돈다.
 *
 * **셸 칸만 제목이 예전 그대로다.** 접미사를 붙이면 앞 판이 띄워 둔 pty 를 못 찾아
 * 새로 만들고, 예전 것은 아무도 안 거두는 채 서버에 남는다. 한 줄짜리 예외의 값이 그것이다.
 */
export function paneServerTitle(name: string): string {
  return name === SHELL_PANE ? DRAWER_TITLE : `${DRAWER_TITLE}:${name}`
}

/** FitAddon 은 창을 끌 때마다 부른다 — 매번 HTTP 를 때리지 않게 묶는다. */
const RESIZE_DEBOUNCE_MS = 120

interface Pane {
  name: string
  ptyId: string
  root: string
  socket: PtySocket
  /** 지나간 출력. 다음 층(`read_logs`)이 이걸 읽는다 (`outputBuffer.ts`) */
  buffer: OutputBuffer
  size: { rows: number; cols: number } | null
  resizeTimer: NodeJS.Timeout | null
}

export interface PtyPoolEvents {
  /**
   * 소켓 핸드셰이크가 끝났다 — **이제 써도 된다.**
   *
   * `open()` 이 돌아온 시점의 소켓은 아직 CONNECTING 이고, 그때 쓴 바이트는 아무 흔적 없이
   * 사라진다 (`PtySocket.open` 의 실측). 「맡아 둔 명령」이 이 신호를 기다린다.
   */
  onOpen(projectId: string, name: string): void
  onData(projectId: string, name: string, chunk: string): void
  onExit(projectId: string, name: string, exitCode: number | null): void
}

export interface PtyPoolOptions {
  /** 그 프로젝트의 서버에 붙는 클라이언트. 서버가 아직 없으면 거절한다 (`drawerBridge`) */
  clientFor: () => Promise<PtyClient>
  events: PtyPoolEvents
}

export interface PaneOpenResult {
  /**
   * **이 칸은 이미 돌고 있었다** — 우리가 새로 띄운 것이 아니다.
   *
   * 두 경로가 여기로 모인다: 우리 표에 이미 있었거나(같은 판에서 두 번 열었다), 서버에
   * 우리 제목의 pty 가 살아 있어 되찾았거나(앱을 껐다 켰다). 부르는 쪽에서는 **둘 다 같은
   * 뜻**이다 — 명령을 또 밀어 넣으면 개발 서버가 둘이 된다 (`run_project` 의 「겹쳐 띄우지
   * 않는다」, 설계 §3).
   *
   * 셸 칸에서는 이 값이 늘 참에 가깝고 그게 정상이다 — 되찾기가 셸 칸의 설계다(머리말의 표).
   * 그래서 화면에서 칸을 펴는 쪽(`drawerBridge.open`)은 이 값을 보지 않는다.
   */
  reclaimed: boolean
}

export class PtyPool {
  /** projectId → (name → 칸) */
  private readonly panes = new Map<string, Map<string, Pane>>()

  constructor(private readonly options: PtyPoolOptions) {}

  /**
   * 그 이름의 칸을 연다. 이미 붙어 있으면 아무 일도 안 한다.
   *
   * 서버에 이미 우리 pty 가 있으면 **되찾는다** — 앱을 껐다 켜도 그 셸과 스크롤백이 그대로다
   * (`cursor=0` 으로 붙으면 서버가 앞부분을 다시 보내 준다, 실측).
   *
   * 실패는 삼키지 않고 던진다. 사유가 그대로 화면에 올라가야 한다 — 빈 터미널만 보여 주면
   * 사용자가 자기 탓으로 여긴다.
   *
   * **이미 돌고 있었는지를 돌려준다** (`PaneOpenResult`). 화면에서 칸을 펴는 쪽은 그 값을
   * 안 보지만, 거기에 명령을 밀어 넣는 쪽(`run_project`)에게는 그것이 곧 「겹쳐 띄우지
   * 않는다」의 판정이다.
   */
  async open(project: { id: string; root: string }, name: string): Promise<PaneOpenResult> {
    if (this.paneOf(project.id, name) !== undefined) return { reclaimed: true }

    const client = await this.options.clientFor()
    const title = paneServerTitle(name)
    const existing = (await client.list(project.root)).find(
      (pty) => pty.title === title && pty.status === 'running',
    )
    const pty = existing ?? (await client.create(project.root, { title }))
    this.attach(client, project, name, pty.id)
    return { reclaimed: existing !== undefined }
  }

  private attach(
    client: PtyClient,
    project: { id: string; root: string },
    name: string,
    ptyId: string,
  ): void {
    const socket = new PtySocket({
      url: client.socketUrl(project.root, ptyId),
      headers: client.headers,
    })
    const pane: Pane = {
      name,
      ptyId,
      root: project.root,
      socket,
      buffer: new OutputBuffer(),
      size: null,
      resizeTimer: null,
    }
    this.paneMap(project.id).set(name, pane)

    socket.onOpen(() => this.options.events.onOpen(project.id, name))
    socket.onData((chunk) => {
      // **버퍼가 먼저다.** 화면으로 보내는 길에서 던지면(창이 닫히는 중 등) 그 줄이
      // 어디에도 안 남는다 — 로그를 붙들고 있는 것이 이 기능의 무게중심이다.
      pane.buffer.push(chunk)
      this.options.events.onData(project.id, name, chunk)
    })
    // 소켓 오류는 **버퍼에 안 넣는다.** 프로세스가 낸 글자가 아니라 우리가 지은 문장이라,
    // 섞으면 `read_logs` 가 프로세스 출력으로 읽는다. 화면에만 띄운다.
    socket.onError((error) => this.options.events.onData(project.id, name, `\r\n[${error.message}]\r\n`))
    // close 는 대개 "셸이 끝났다" 다. 종료 코드는 프레임에 없어 다시 물어봐야 안다 (실측).
    socket.onClose(() => void this.reportExit(project.id, pane))
    socket.open()
  }

  /** 그 칸에 바이트를 넣는다. 아직 안 열렸으면 `false` — 부르는 쪽이 맡아 둘지 정한다. */
  write(projectId: string, name: string, data: string): boolean {
    return this.paneOf(projectId, name)?.socket.write(data) ?? false
  }

  /**
   * 크기 변경. **묶어서 보낸다** — FitAddon 이 창 크기를 끄는 동안 계속 부르는데
   * 그때마다 HTTP 를 때리면 요청이 수십 개 쌓인다.
   *
   * ⚠️ **0 은 보내지 않는다** (`isSendableSize` — 왜 지금은 도달 불가인데도 두는지가 거기 있다).
   * 여기서 먼저 걸러 디바운스 타이머조차 걸지 않는다. 아래 `.catch(() => {})` 가 실패를
   * 삼키므로, 못 보낼 값이 여기까지 오면 **아무 흔적 없이 사라진다.**
   */
  resize(projectId: string, name: string, size: { rows: number; cols: number }): void {
    if (!isSendableSize(size)) return
    const pane = this.paneOf(projectId, name)
    if (pane === undefined) return
    if (pane.size?.rows === size.rows && pane.size.cols === size.cols) return
    pane.size = { rows: size.rows, cols: size.cols }

    if (pane.resizeTimer !== null) clearTimeout(pane.resizeTimer)
    pane.resizeTimer = setTimeout(() => {
      pane.resizeTimer = null
      const latest = pane.size
      if (latest === null) return
      void this.options
        .clientFor()
        .then((client) => client.resize(pane.root, pane.ptyId, latest))
        // 크기 조절 실패로 칸을 죽이지 않는다 — 글자는 계속 흐른다
        .catch(() => {})
    }, RESIZE_DEBOUNCE_MS)
  }

  /** 지나간 출력. 없는 칸이면 null — 다음 층(`read_logs`)이 "그런 프로세스 없음" 으로 답한다. */
  snapshot(projectId: string, name: string): OutputSnapshot | null {
    return this.paneOf(projectId, name)?.buffer.snapshot() ?? null
  }

  /** 그 칸에서 손을 뗀다. **pty 는 죽이지 않는다** (머리말의 표). */
  detach(projectId: string, name: string): void {
    this.forget(projectId, name)
  }

  /** 탭의 ✕ — **프로세스도 멈춘다.** */
  async close(projectId: string, name: string): Promise<void> {
    const pane = this.paneOf(projectId, name)
    if (pane === undefined) return
    this.forget(projectId, name)
    await this.remove(pane)
  }

  /** 프로젝트 탭을 닫았다 — 그 프로젝트의 칸을 통째로 거둔다. */
  async closeProject(projectId: string): Promise<void> {
    await Promise.all(this.namesOf(projectId).map((name) => this.close(projectId, name)))
  }

  /** 앱을 끈다. **되찾을 수 없는 칸만 거둔다** (머리말의 표). */
  async dispose(): Promise<void> {
    const doomed: Pane[] = []
    for (const projectId of [...this.panes.keys()]) {
      for (const name of this.namesOf(projectId)) {
        const pane = this.paneOf(projectId, name)
        if (pane !== undefined && name !== SHELL_PANE) doomed.push(pane)
        this.forget(projectId, name)
      }
    }
    await Promise.all(doomed.map((pane) => this.remove(pane)))
  }

  private async reportExit(projectId: string, pane: Pane): Promise<void> {
    this.forget(projectId, pane.name)
    const pty = await this.options
      .clientFor()
      .then((client) => client.get(pane.root, pane.ptyId))
      .catch(() => null)
    this.options.events.onExit(projectId, pane.name, pty?.exitCode ?? null)
  }

  /** 서버에서 지운다. 실패는 삼킨다 — 이미 없어진 pty 를 지우려는 것이 가장 흔한 사유다. */
  private async remove(pane: Pane): Promise<void> {
    await this.options
      .clientFor()
      .then((client) => client.remove(pane.root, pane.ptyId))
      .catch(() => {})
  }

  /** 소켓을 접고 표에서 지운다. 서버 쪽 pty 는 그대로 둔다. */
  private forget(projectId: string, name: string): void {
    const pane = this.paneOf(projectId, name)
    if (pane === undefined) return
    const byName = this.panes.get(projectId)
    byName?.delete(name)
    if (byName?.size === 0) this.panes.delete(projectId)
    if (pane.resizeTimer !== null) clearTimeout(pane.resizeTimer)
    pane.socket.close()
  }

  private paneOf(projectId: string, name: string): Pane | undefined {
    return this.panes.get(projectId)?.get(name)
  }

  private namesOf(projectId: string): string[] {
    return [...(this.panes.get(projectId)?.keys() ?? [])]
  }

  private paneMap(projectId: string): Map<string, Pane> {
    const existing = this.panes.get(projectId)
    if (existing !== undefined) return existing
    const created = new Map<string, Pane>()
    this.panes.set(projectId, created)
    return created
  }
}
