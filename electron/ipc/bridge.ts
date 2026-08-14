import { ipcMain, type BrowserWindow } from 'electron'
import { ChatAskHub } from '../extensions/chatAskHub'
import { Channel, type ProjectScoped, type SessionStatePayload } from '../../shared/ipc/channels'
import { registerSessionHandlers, SESSION_CHANNELS } from './sessionHandlers'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import { ProjectSession } from '../session/projectSession'
import type { OpencodeServerPool } from '../opencode/serverPool'
import { diagnose, noEndpointDiagnostics } from '../runtime/diagnostics'

// IPC 배선과 라우팅만 책임진다. 프로토콜 판단도, 세션 수명 관리도 하지 않는다.
//
// 세션은 **프로젝트마다 하나**다 (설계 §2). 지연 연결이라 탭을 처음 활성화할 때 만들고,
// 한 번 만든 세션은 앱이 살아 있는 동안 유지한다 — 비활성 탭에서도 턴이 계속 돌아야 한다.
//
// **서버도 프로젝트마다 하나다** (`opencode/serverPool.ts`). 앱 단위로 받던 주소 설정
// (`BridgeConfig.opencodeUrl`)이 없어진 자리에 풀이 들어왔다 — 세션을 만들기 전에
// 풀에게 그 프로젝트의 주소를 묻고, 없으면 풀이 그때 띄운다. 여기가 **띄우기와 세션이
// 만나는 유일한 자리**라서, 탭을 닫을 때 서버까지 거두는 판단도 이 클래스가 쥔다.

/**
 * 세션이 opencode 에 **실제로 붙었다/떨어졌다**를 앱 단위 관심사에 알린다.
 *
 * 지금 듣는 곳은 데스크톱 MCP 자동 등록 하나다 (`electron/mcp/desktopMcp.ts`).
 * opencode 의 MCP 등록이 instance 수명이라 **붙을 때마다 다시 등록해야** 하는데,
 * 그 신호를 낼 수 있는 곳이 여기다 — 여기만 프로젝트 신원(id·root)과 핸드셰이크
 * 상태를 동시에 안다. `electron/session/*` 은 이 흐름을 몰라도 된다.
 */
export interface SessionBridgeHooks {
  onSessionReady?(project: ProjectRecord): void
  onSessionLost?(projectId: string): void
}

const HANDLED_CHANNELS = [...SESSION_CHANNELS, Channel.SESSION_DIAGNOSE]

export class SessionBridge {
  private readonly sessions = new Map<string, ProjectSession>()
  /** 같은 프로젝트로 start() 가 겹쳐 들어와도 한 번만 돌게 막는다 */
  private readonly starting = new Map<string, Promise<void>>()
  private activeId: string | null = null

  constructor(
    private readonly window: BrowserWindow,
    /** 프로젝트별 opencode 서버. 세션보다 먼저 뜨고 세션보다 늦게 죽는다 */
    private readonly pool: OpencodeServerPool,
    private readonly hooks: SessionBridgeHooks = {},
  ) {}

  register(): void {
    registerSessionHandlers(() => this.active)
    ipcMain.handle(Channel.SESSION_DIAGNOSE, () => {
      const endpoint = this.active?.currentEndpoint ?? null
      return endpoint === null ? noEndpointDiagnostics() : diagnose(endpoint)
    })
  }

  /** 활성 세션의 runtime 정보. 피드백이 로그를 붙이는 데 쓴다. */
  runtimeInfo(): { instanceDir: string | null; runtimeVersion: string | null } {
    return this.active?.runtimeInfo ?? { instanceDir: null, runtimeVersion: null }
  }

  private get active(): ProjectSession | null {
    return this.activeId === null ? null : (this.sessions.get(this.activeId) ?? null)
  }

  /**
   * 이 프로젝트를 활성으로 삼고, 세션이 없으면 만든다 (지연 연결, 설계 §2.2).
   *
   * 이미 있는 세션은 **다시 시작하지 않는다** — 돌고 있던 턴이 끊긴다.
   */
  /**
   * 확장의 `chat.ask` 장부 (설계 2026-08-13).
   *
   * 브리지가 쥐는 이유는 둘을 다 갖고 있어서다 — **창**(요청을 화면 큐로 밀어 넣는 길)과
   * **세션 생성**(그 턴을 되찾을 포트를 꽂는 자리).
   */
  private readonly chatAsk = new ChatAskHub((projectId, payload) => {
    if (this.window.isDestroyed()) return false
    this.push(Channel.EXTENSION_CHAT_ASK, projectId, payload)
    return true
  })

  /** 확장이 물었다. 답이 올 때까지 기다리는 promise 를 돌려준다. */
  ask(projectId: string | null, query: string) {
    return this.chatAsk.ask(projectId, query)
  }

  /**
   * 그 프로젝트의 도는 턴을 끊는다 — 확장 화면의 「중단」이 여기로 온다.
   *
   * **끊는 사람은 사용자다.** 확장이 스스로 부르는 길은 없다 (설계 2026-08-13):
   * 화면에 보이는 턴을 확장이 뒤에서 죽이면 안 된다. 확장이 기다리던 약속은
   * `ChatSession.cancel` 이 취소로 풀어 준다.
   */
  cancelTurn(projectId: string | null): void {
    const target = projectId === null ? this.active : (this.sessions.get(projectId) ?? null)
    target?.cancel()
  }

  async activate(project: ProjectRecord): Promise<void> {
    this.activeId = project.id
    if (this.sessions.has(project.id) || this.starting.has(project.id)) {
      await this.starting.get(project.id)
      return
    }

    // **자리를 먼저 잡는다.** 아래 launch 는 서버가 뜰 때까지(수 초) 기다리는데, 그동안
    // 같은 프로젝트로 activate 가 또 들어오면 위 검사를 통과해 세션이 둘 생긴다 —
    // 서버 주소를 묻는 await 가 생기면서 새로 열린 창이다.
    const started: Promise<void> = this.launch(project).finally(() => {
      if (this.starting.get(project.id) === started) this.starting.delete(project.id)
    })
    this.starting.set(project.id, started)
    await started
  }

  /**
   * 그 프로젝트의 서버 주소를 얻고(없으면 띄우고) 세션을 만든다.
   *
   * **서버를 못 띄우면 세션도 없다.** 실행 파일을 못 찾았거나 서버가 주소를 안 알린
   * 경우인데, 둘 다 화면에는 "연결 안 됨" 으로만 보이는 종류라 사유를 그대로 실어 보낸다
   * (`binary.ts` 는 찾아본 자리를 통째로 준다).
   */
  private async launch(project: ProjectRecord): Promise<void> {
    let opencodeUrl: string
    try {
      opencodeUrl = await this.pool.urlFor(project.id, project.root)
    } catch (error) {
      this.push(Channel.SESSION_STATE, project.id, {
        handshake: {
          stage: 'failed',
          failure: {
            stage: 'awaiting_connected',
            reason: error instanceof Error ? error.message : String(error),
          },
        },
      } satisfies SessionStatePayload)
      this.hooks.onSessionLost?.(project.id)
      return
    }
    // 서버를 기다리는 사이에 탭이 닫혔다 — 세션을 만들면 아무도 안 접는 연결이 된다.
    // (서버는 `closeProject` 가 이미 거뒀거나, 풀이 뜨는 즉시 거둔다)
    if (!this.starting.has(project.id)) return

    const session = new ProjectSession(
      {
        opencodeUrl,
        workspacePath: project.root,
        projectName: project.name,
      },
      {
        onState: (state) => {
          this.push(Channel.SESSION_STATE, project.id, state)
          // ready 를 오갈 때마다 알린다. 같은 상태가 여러 번 올라올 수 있으므로
          // 중복을 거르는 일은 듣는 쪽에 맡긴다 (여기서 걸면 이 클래스가 상태를 하나 더 진다).
          if (state.handshake.stage === 'ready') this.hooks.onSessionReady?.(project)
          else this.hooks.onSessionLost?.(project.id)
        },
        onTurnEvent: (event) => this.push(Channel.TURN_EVENT, project.id, event),
        onSnapshot: (snapshot) => this.push(Channel.CHAT_SNAPSHOT, project.id, snapshot),
        onPermissionMode: (mode) => this.push(Channel.PERMISSION_MODE_CHANGED, project.id, { mode }),
        onWorkingDir: (state) => this.push(Channel.WORKING_DIR_CHANGED, project.id, state),
        onHistoryState: (state) => this.push(Channel.HISTORY_STATE, project.id, state),
        onReviewState: (reviews) => this.push(Channel.REVIEW_STATE, project.id, { reviews }),
        onMcpState: (state) => this.push(Channel.MCP_STATE, project.id, state),
        onModelState: (state) => this.push(Channel.MODEL_STATE, project.id, state),
        onNotification: (n) => this.push(Channel.NOTIFICATION, project.id, n),
        binder: this.chatAsk.bookFor(project.id),
      },
    )
    this.sessions.set(project.id, session)
    await session.start()
  }

  /** 절전 복귀 — 열려 있다고 믿는 소켓을 전부 다시 붙인다 (ProjectSession.wakeFromSleep) */
  wakeAll(): void {
    for (const session of this.sessions.values()) session.wakeFromSleep()
  }

  async reconnect(project: ProjectRecord): Promise<void> {
    // 서버는 살려 둔다 — 세션만 다시 붙이면 되는 자리이고, 서버를 죽였다 살리면
    // 그만큼(수 초) 더 기다리는데다 그 사이 MCP 등록도 통째로 날아간다
    await this.closeProject(project.id, { keepRuntime: true })
    await this.activate(project)
  }

  /**
   * **우리가 띄운 서버까지 접고** 전부 다시 띄운다. Doctor 사다리의 마지막 칸이다.
   *
   * 재연결(`reconnect`)과 다른 점이 바로 여기다 — 저쪽은 세션만 다시 붙이고 서버는 그대로
   * 둔다. 서버 자체가 이상할 때(설정을 다시 읽어야 한다·응답이 없다) 손댈 곳이 이것뿐이라
   * 남겨 둔다. davis 시절 이 이름은 "우리가 설치한 runtime 재시작" 이었고, opencode 로
   * 오면서 한동안 **아무것도 못 죽이는 껍데기**였다 (서버가 남의 프로세스였다).
   */
  async restartRuntime(projects: ProjectRecord[]): Promise<void> {
    const previous = this.activeId
    for (const session of this.sessions.values()) await session.dispose()
    this.sessions.clear()
    // 진행 중이던 start 도 무효 — 남기면 아래 activate 가 그걸 기다리다 세션을 안 만든다
    this.starting.clear()
    this.activeId = null
    // 세션을 다 접은 뒤에 죽인다. 먼저 죽이면 아직 붙어 있는 SSE 가 재연결 백오프를 돈다.
    await this.pool.stopAll()

    // 열려 있던 프로젝트를 모두 되살린다. 활성은 원래대로 돌려놓는다.
    for (const project of projects) await this.activate(project)
    const active = projects.find((project) => project.id === previous)
    if (active) this.activeId = active.id
  }

  /**
   * 탭을 닫으면 그 세션도 접고 **그 프로젝트의 서버도 거둔다.** 열어 둔 채로 두면
   * 연결만 쌓이고, 이제는 프로세스도 함께 쌓인다.
   *
   * `keepRuntime` 은 재연결이 쓴다 — 그때는 서버를 살려 둔다 (`reconnect` 주석).
   * 이 이름은 davis 시절 "우리가 설치한 runtime" 에서 왔고, 지금 가리키는 것은
   * **이 프로젝트의 opencode 서버**다. 남의 프로세스에 붙기만 하던 동안에는 아무 뜻도
   * 없던 인자였다.
   */
  async closeProject(id: string, options: { keepRuntime?: boolean } = {}): Promise<void> {
    // 시작 중이던 것은 여기서 무효가 된다. 남겨 두면 다음 activate 가 **죽은 start 를 기다리고**
    // 새 세션을 아예 만들지 않는다 — 라이선스를 고쳐도 옛 키로 붙은 채 안 바뀌던 원인.
    this.starting.delete(id)
    const session = this.sessions.get(id)
    this.sessions.delete(id)
    if (this.activeId === id) this.activeId = null
    // 세션이 없어도 서버는 있을 수 있다 (주소는 받았는데 붙지 못한 경우) — 먼저 접고 거둔다
    if (session) {
      this.hooks.onSessionLost?.(id)
      await session.dispose(options)
    }
    if (options.keepRuntime !== true) await this.pool.stop(id)
  }

  /**
   * 창이 사라졌거나 앱이 끝난다. **우리가 띄운 서버를 전부 회수한다** —
   * 사용자가 손으로 띄운 것은 표에 없으므로 손대지 않는다 (`serverPool.ts` 머리말).
   */
  async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    this.starting.clear()
    this.activeId = null
    await Promise.all(sessions.map((session) => session.dispose()))
    await this.pool.stopAll()
    for (const channel of HANDLED_CHANNELS) ipcMain.removeHandler(channel)
  }

  // 프로젝트 겉봉을 씌워 보낸다. 비활성 프로젝트 이벤트도 그대로 — 안 그려도 배지는 갱신해야 한다(§5).
  private push(channel: string, projectId: string, payload: unknown): void {
    if (this.window.isDestroyed()) return
    const scoped: ProjectScoped<unknown> = { projectId, payload }
    this.window.webContents.send(channel, scoped)
  }
}
