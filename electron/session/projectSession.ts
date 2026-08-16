import type { PermissionMode } from '../../shared/protocol/kinds'
import type { ChatSendContext } from '../../shared/ipc/chatPayloads'
import type { SessionStatePayload } from '../../shared/ipc/channels'
import { normalizeSendContext } from './editorContext'
import type { SessionConnection } from '../ws/transport'
import { opencodeEndpoint } from '../opencode/endpoint'
import type { Heartbeat } from '../ws/heartbeat'
import type { Handshake } from './handshake'
import type { ChatSession } from './chatSession'
import { runShell } from './shellRunner'
import { modelChangeLabel, recordLocalNotice, recordShellResult } from './shellRecord'
import { wireSession } from './sessionWiring'
import { primeOnFirstReady, reprimeAfterReconnect, type ReadyTargets } from './sessionReady'
import { wakeConnection } from './sessionWake'
import type { PermissionModeController } from './permissionMode'
import type { ChatHistoryController } from './chatHistory'
import type { TurnReviewController } from './turnReview'
import type { McpConfigController } from './mcpConfig'
import type { LlmConfigController } from './llmConfig'
import type { NotificationController } from './notifications'
import type { ProjectSessionListener } from './projectSessionListener'
import type { ApprovalFollowUp } from './chatFrames'
import { logStore } from '../logs/logStore'

// 한 프로젝트의 세션 수명 전부 — 탐색 → 연결 → 핸드셰이크 → 채팅.
// renderer 로 직접 보내지 않고 콜백으로만 낸다 — 어디로 보낼지는 SessionBridge 가 정한다
// (비활성 프로젝트 배지만 갱신 같은 판단을 이 클래스 밖에서 하게 하려고).

export interface ProjectSessionConfig {
  workspacePath: string
  /** 표시용 프로젝트 이름. workspace_sync 로 나가 runtime 이 프로젝트를 식별한다. */
  projectName?: string
  /**
   * 붙을 opencode 헤드리스 서버. **필수다.**
   *
   * 기본값(`127.0.0.1:4096`)이 있었다 — 서버가 앱 전체에 하나였을 때다. 지금은
   * **프로젝트마다 하나를 우리가 띄우고**(`opencode/serverPool.ts`) 그 주소를 받아 오므로,
   * 기본값으로 물러나는 것은 곧 남의 프로젝트 서버에 붙는 것이다.
   */
  opencodeUrl: string
}

export class ProjectSession {
  /** 마지막으로 알린 핸드셰이크 상태. 소켓만 바뀌었을 때 함께 실어 보낸다. */
  private lastHandshake: SessionStatePayload['handshake'] = { stage: 'idle' }
  /** 첫 ready 인지 재연결 후 ready 인지 가른다 — 초기화는 run() 이 하고 재적용만 여기서 한다 */
  private hasBeenReady = false
  private endpoint: { host: string; port: number; source: string } | null = null
  /** 직전 요청의 모델 오버라이드. undefined=요청 없음, null=기본 모델 (구분선 판정용). */
  private lastModel: string | null | undefined = undefined
  private connection: SessionConnection | null = null
  private heartbeat: Heartbeat | null = null
  private handshake: Handshake | null = null
  private chat: ChatSession | null = null
  private permission: PermissionModeController | null = null
  private history: ChatHistoryController | null = null
  private reviews: TurnReviewController | null = null
  private mcp: McpConfigController | null = null
  private llm: LlmConfigController | null = null
  private notifications: NotificationController | null = null

  constructor(
    private readonly config: ProjectSessionConfig,
    private readonly listener: ProjectSessionListener,
  ) {}

  /** davis 런타임 개념이 없다 — 화면 계약을 지키려고 빈 값을 준다. */
  get runtimeInfo(): { instanceDir: string | null; runtimeVersion: string | null } {
    return { instanceDir: null, runtimeVersion: null }
  }

  /** 지금 붙어 있는(또는 붙으려던) runtime 위치. 진단이 쓴다. */
  get currentEndpoint(): { host: string; port: number; source: string } | null {
    return this.endpoint
  }

  /**
   * opencode 서버는 **찾지 않는다 — 주소를 받아 온다.**
   *
   * davis 시절엔 포트 8000~8099 를 훑어 인스턴스 파일로 런타임을 찾았지만(`electron/runtime/`),
   * 여기서는 이미 정해진 주소로 붙는다. 그 주소가 어디서 오는지가 한 번 바뀌었다:
   * **사용자가 띄운 한 곳** → **`SessionBridge` 가 이 프로젝트용으로 띄운 서버**
   * (`opencode/serverPool.ts`). 세션은 그 차이를 몰라도 된다 — 못 띄웠으면 여기까지
   * 오지도 않고, 떠 있는데 못 붙으면 connect() 가 거부하며 이유가 그대로 화면에 뜬다.
   */
  async start(): Promise<void> {
    const endpoint = opencodeEndpoint(this.config.opencodeUrl)
    this.endpoint = endpoint
    this.emitState({ stage: 'awaiting_connected' }, 'connecting')

    this.wire(endpoint)
    await this.run()
  }

  /** 컨트롤러 생성·구독·시작은 sessionWiring 몫이다 — 여기는 수명 판단만 남긴다 */
  private wire(endpoint: { host: string; port: number; source: string }): void {
    const wired = wireSession({
      endpoint,
      config: this.config,
      listener: this.listener,
      onHandshakeState: (state) => this.emitState(state),
      onConnectionState: (state) => this.emitState(this.lastHandshake, state),
      // 확장이 이 프로젝트의 채팅으로 물으면 그 턴을 되찾을 자리 (설계 2026-08-13)
      ...(this.listener.binder ? { binder: this.listener.binder } : {}),
    })
    this.connection = wired.connection
    this.heartbeat = wired.heartbeat
    this.handshake = wired.handshake
    this.chat = wired.chat
    this.permission = wired.permission
    this.history = wired.history
    this.reviews = wired.reviews
    this.mcp = wired.mcp
    this.llm = wired.llm
    this.notifications = wired.notifications
  }

  /** private 필드는 구조적 타입을 못 만족시킨다 — 넘길 것만 골라 싣는다 */
  private get readyTargets(): ReadyTargets {
    return { permission: this.permission, history: this.history, mcp: this.mcp, llm: this.llm }
  }

  private async run(): Promise<void> {
    const handshake = this.handshake!
    const ready = handshake.run()
    // 연결이 먼저 실패하면 ready 가 거부될 수 있다 — 상태는 onStateChange 로 가므로 여기선 rejection 만 막는다
    ready.catch(() => {})

    try {
      await this.connection!.connect()
      await ready
      primeOnFirstReady(this.readyTargets)
    } catch (error) {
      // 상태는 handshake.onStateChange 로 이미 전달됐다. 연결 자체가 실패한 경우만 보완한다.
      if (handshake.state.stage !== 'failed') {
        this.emitState({
          stage: 'failed',
          failure: {
            stage: 'awaiting_connected',
            reason: error instanceof Error ? error.message : String(error),
          },
        })
      }
    }
  }

  private emitState(
    handshake: SessionStatePayload['handshake'],
    connection?: SessionStatePayload['connection'],
  ): void {
    // 데스크탑 로그에 남긴다 — 메인은 평소 조용해서 이걸 안 남기면 로그 창이 빈다
    const bits = [`handshake=${handshake.stage}`, connection && `conn=${connection}`, handshake.failure?.reason]
    logStore.add('desktop', `[${this.config.workspacePath.split('/').pop()}] ${bits.filter(Boolean).join(' · ')}`)

    // 끊겼다 다시 ready 가 됐으면 runtime 쪽 세션이 갈아 끼워진 것이다
    if (handshake.stage === 'ready' && this.lastHandshake.stage !== 'ready' && this.hasBeenReady) {
      reprimeAfterReconnect(this.readyTargets)
    }
    if (handshake.stage === 'ready') this.hasBeenReady = true

    this.lastHandshake = handshake
    this.listener.onState({
      handshake,
      ...(this.endpoint ? { endpoint: this.endpoint } : {}),
      ...(connection !== undefined ? { connection } : {}),
    })
  }

  /** 절전 복귀 — 살아 있다고 믿던 소켓을 버리고 다시 붙는다 (sessionWake.ts) */
  wakeFromSleep(): void {
    wakeConnection(this.connection)
  }

  send(query: string, context: ChatSendContext = {}): void {
    // 모델이 직전 요청과 달라졌으면 구분선을 남긴다 (DC-1322 미러)
    const override = context.model?.trim() || null
    const label = modelChangeLabel(this.lastModel, override)
    if (label) this.chat?.addLocal((messages) => messages.addSystem(label))
    this.lastModel = override
    // renderer 는 루트 상대경로로 준다 — 절대경로 변환과 `git:` 가짜 탭 제외는 여기 한 곳에서.
    // workspacePath 를 아는 것은 main 뿐이라 renderer 로 루트를 내려보내지 않는다.
    this.chat?.send(query, normalizeSendContext(context, this.config.workspacePath))
  }

  /** `!명령` 을 프로젝트 폴더에서 실행하고 결과를 대화에 남긴다 */
  async runShell(command: string): Promise<void> {
    const result = await runShell(command, this.config.workspacePath)
    this.chat?.addLocal((messages) => recordShellResult(messages, result))
  }

  /** 로컬 안내 한 쌍을 대화에 남긴다 (이스터에그 등 — runtime 을 거치지 않는다) */
  addLocalNotice(payload: { userText: string; noticeText: string }): void {
    this.chat?.addLocal((messages) => recordLocalNotice(messages, payload.userText, payload.noticeText))
  }

  cancel(): void { this.chat?.cancel() }

  respondApproval(requestId: string, approved: boolean, followUp?: ApprovalFollowUp): void {
    this.chat?.respondApproval(requestId, approved, followUp)
  }
  respondQuestion(questionId: string, answer: string | null): void { this.chat?.respondQuestion(questionId, answer) }
  respondPlan(planId: string, approved: boolean, comment?: string): void { this.chat?.respondPlan(planId, approved, comment) }

  /** 현재 대화 제목 변경 (/rename). ChatHistoryController 가 현재 대화를 정본으로 안다. */
  renameCurrentChat(title: string): void {
    this.history?.renameCurrent(title)
  }

  /** 새 대화. 리뷰도 비우고, 새 chat_id 를 발급받아 다음 대화가 새 이력이 되게 한다. */
  reset(): void {
    this.lastModel = undefined // 새 대화의 첫 요청엔 구분선을 긋지 않는다
    this.chat?.reset()
    this.reviews?.reset()
    this.history?.requestNewChat()
    this.history?.requestList()
  }

  decideReview(turnId: string, decision: 'accept' | 'reject', filePaths?: string[]): void {
    this.reviews?.decide(turnId, decision, filePaths)
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permission?.set(mode)
  }

  requestMcpStatus(): void {
    this.mcp?.requestStatus()
  }

  /** 모델 스위처 상태를 다시 받아온다 (status → personal 이면 models 조회로 이어진다) */
  requestModelOptions(): void {
    this.llm?.requestModelOptions()
  }

  setMcpCredentials(serverName: string, credentials: Record<string, string>, enabled: boolean): void {
    this.mcp?.set(serverName, credentials, enabled)
  }

  testMcpCredentials(serverName: string, credentials: Record<string, string>): void {
    this.mcp?.test(serverName, credentials)
  }

  /** `search` 를 주면 목록을 서버에서 걸러 받는다 (`chatHistory.ts` 의 requestList 주석). */
  requestHistoryList(search?: string): void {
    this.history?.requestList(search)
  }

  loadHistory(chatId: string): void {
    this.lastModel = undefined // 불러온 대화도 첫 요청 취급 — 재생분과 구분선이 섞이면 안 된다
    this.chat?.reset() // 화면을 비우고 재생 — 안 그러면 이전 내용에 겹쳐 중복된다 (turn_ended 가 열린 HIL 카드도 정리)
    // runtime 은 인터럽트 청크도 원형 재전송한다 — load_complete 까지 죽은 인터럽트를 억제 (DC-866)
    this.chat?.beginHistoryReplay()
    this.history?.load(chatId)
  }

  removeHistory(chatId: string): void {
    this.history?.remove(chatId)
  }

  renameHistory(chatId: string, title: string): void {
    this.history?.rename(chatId, title)
  }

  // 세션을 접는다. keepRuntime 은 재연결에 쓴다 — davis 때는 우리가 띄운 runtime 을 여기서
  // 죽이면 거기 붙어 있던 다른 프로젝트 연결까지 끊겼다.
  async dispose(options: { keepRuntime?: boolean } = {}): Promise<void> {
    // **서버를 끄는 것은 여기가 아니다.** 이제 그 서버는 우리가 띄운 것이지만
    // (`opencode/serverPool.ts`), 세션 하나가 프로세스 수명을 쥐면 같은 프로젝트를
    // 재연결할 때마다 서버가 죽었다 살아난다. 판단은 `SessionBridge.closeProject` 에 있고
    // 이 인자는 거기서 쓴다 — 여기서는 계약만 지킨다.
    void options
    this.handshake?.dispose()
    this.permission?.stop()
    this.history?.stop()
    this.reviews?.stop()
    this.mcp?.stop()
    this.llm?.stop()
    this.notifications?.stop()
    this.chat?.stop()
    this.heartbeat?.stop()
    this.connection?.dispose()
  }
}
