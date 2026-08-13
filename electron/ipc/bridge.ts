import { ipcMain, type BrowserWindow } from 'electron'
import { ChatAskHub } from '../extensions/chatAskHub'
import { Channel, type ProjectScoped } from '../../shared/ipc/channels'
import { registerSessionHandlers, SESSION_CHANNELS } from './sessionHandlers'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import { ProjectSession, type ProjectSessionConfig } from '../session/projectSession'
import { diagnose, noEndpointDiagnostics } from '../runtime/diagnostics'

// IPC 배선과 라우팅만 책임진다. 프로토콜 판단도, 세션 수명 관리도 하지 않는다.
//
// 세션은 **프로젝트마다 하나**다 (설계 §2). 지연 연결이라 탭을 처음 활성화할 때 만들고,
// 한 번 만든 세션은 앱이 살아 있는 동안 유지한다 — 비활성 탭에서도 턴이 계속 돌아야 한다.

/** 세션이 프로젝트별로 갈리므로 라이선스·기동 방법만 앱 단위로 받는다 */
export type BridgeConfig = Omit<ProjectSessionConfig, 'workspacePath' | 'projectName'>

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
    // 갱신 가능 — Admin 주소·포트가 설정탭에서 바뀌면 앱 재시작 없이 여기 반영한다
    private config: BridgeConfig,
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

    const session = new ProjectSession(
      {
        ...this.config,
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

    // 자기 자신일 때만 지운다 — 접혔다 다시 시작한 뒤라면 지금 것은 새 start 다
    const started: Promise<void> = session.start().finally(() => {
      if (this.starting.get(project.id) === started) this.starting.delete(project.id)
    })
    this.starting.set(project.id, started)
    await started
  }

  /** 절전 복귀 — 열려 있다고 믿는 소켓을 전부 다시 붙인다 (ProjectSession.wakeFromSleep) */
  wakeAll(): void {
    for (const session of this.sessions.values()) session.wakeFromSleep()
  }

  async reconnect(project: ProjectRecord): Promise<void> {
    // runtime 은 살려 둔다 — 죽이면 거기 붙어 있던 다른 프로젝트까지 끊긴다
    await this.closeProject(project.id, { keepRuntime: true })
    await this.activate(project)
  }

  /**
   * runtime 설정(Admin 주소·포트·채널)을 갱신하고 다시 띄운다. config 는 세션 생성 때
   * 한 번만 읽히므로, 설정탭 저장값을 재시작 없이 반영하려면 갱신 후 재조립해야 한다.
   * (adminApiUrl 이 비어 있다가 채워지면 그제서야 installer 가 생겨 런타임을 받는다)
   */
  async applyRuntimeConfig(patch: Partial<BridgeConfig>, projects: ProjectRecord[]): Promise<void> {
    this.config = { ...this.config, ...patch }
    await this.restartRuntime(projects)
  }

  /** 우리가 띄운 runtime 을 접고 모두 다시 붙인다 (Admin 주소·포트 변경은 재시작해야 적용). */
  async restartRuntime(projects: ProjectRecord[]): Promise<void> {
    const previous = this.activeId
    for (const session of this.sessions.values()) await session.dispose()
    this.sessions.clear()
    // 진행 중이던 start 도 무효 — 남기면 아래 activate 가 그걸 기다리다 세션을 안 만든다
    this.starting.clear()
    this.activeId = null

    // 열려 있던 프로젝트를 모두 되살린다. 활성은 원래대로 돌려놓는다.
    for (const project of projects) await this.activate(project)
    const active = projects.find((project) => project.id === previous)
    if (active) this.activeId = active.id
  }

  /** 탭을 닫으면 그 세션도 접는다. 열어 둔 채로 두면 연결만 쌓인다. */
  async closeProject(id: string, options: { keepRuntime?: boolean } = {}): Promise<void> {
    // 시작 중이던 것은 여기서 무효가 된다. 남겨 두면 다음 activate 가 **죽은 start 를 기다리고**
    // 새 세션을 아예 만들지 않는다 — 라이선스를 고쳐도 옛 키로 붙은 채 안 바뀌던 원인.
    this.starting.delete(id)
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    if (this.activeId === id) this.activeId = null
    this.hooks.onSessionLost?.(id)
    await session.dispose(options)
  }

  async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    this.starting.clear()
    this.activeId = null
    await Promise.all(sessions.map((session) => session.dispose()))
    for (const channel of HANDLED_CHANNELS) ipcMain.removeHandler(channel)
  }

  // 프로젝트 겉봉을 씌워 보낸다. 비활성 프로젝트 이벤트도 그대로 — 안 그려도 배지는 갱신해야 한다(§5).
  private push(channel: string, projectId: string, payload: unknown): void {
    if (this.window.isDestroyed()) return
    const scoped: ProjectScoped<unknown> = { projectId, payload }
    this.window.webContents.send(channel, scoped)
  }
}
