import type { SessionStatePayload } from '../../shared/ipc/channels'
import type { SessionConnection } from '../ws/transport'
import { OpencodeConnection } from '../opencode/connection'
import { opencodeEndpoint } from '../opencode/endpoint'
import { Heartbeat } from '../ws/heartbeat'
import { Handshake } from './handshake'
import { ChatSession } from './chatSession'
import type { TurnBinder } from './turnBinder'
import { PermissionModeController } from './permissionMode'
import { WorkingDirController } from './workingDir'
import { ChatHistoryController } from './chatHistory'
import { TurnReviewController } from './turnReview'
import { McpConfigController } from './mcpConfig'
import { LlmConfigController } from './llmConfig'
import { NotificationController } from './notifications'
import type { ProjectSessionListener } from './projectSessionListener'

// ProjectSession 의 배선 절차 — 연결 위에 컨트롤러들을 만들고 listener 로 잇는다.
// 수명 판단(시작/종료/재연결)은 ProjectSession 에 남기고, 여기는 "무엇이 무엇에
// 연결되는가"만 안다. ProjectSession 에서 응집 분리한 것으로 행동은 그대로다.
//
// **`session/` 안에서 구체 전송 구현을 이름으로 아는 곳은 이 파일 하나다** (설계 §10 DIP).
// 컨트롤러 열한 개·Handshake·ChatSession 은 `ws/transport.ts` 의 인터페이스만 알고,
// 전송을 갈아끼울 때 고칠 자리는 아래 `new OpencodeConnection` 한 줄이다.
// 조립하는 곳은 어차피 구체 이름을 불러야 하므로 그 지식을 여기 모아 둔 것이지,
// 위층으로 새어 나간 것이 아니다 — 팩토리로 주입하면 프로덕션 구현이 하나뿐인데
// 이음매만 하나 더 생긴다. 시험은 `MemoryConnection` 으로 같은 인터페이스에 끼운다.
//
// 주소 해석(`opencodeEndpoint`)도 여기 있다. 2026-08-26 까지는 `ProjectSession` 이
// 그걸 직접 불러서 **고칠 자리가 둘**이었고, 그래서 위 문장이 거짓이었다.

/**
 * 소켓 생사 신호를 받을 곳. RuntimeManager 가 구현한다.
 * **판정은 여기서 하지 않는다** — close 는 일시 끊김에서도 오므로,
 * 헬스로 확인해 사망을 확정하는 일은 RuntimeManager 몫이다 (livenessProbe.ts).
 */
export interface LivenessSink {
  reportConnectionLost(): void
  reportConnectionRestored(): void
}

export interface WireSessionArgs {
  /** `opencodeUrl` 은 주소 해석의 입력이다 — 푼 결과는 `WiredSession.endpoint` 로 돌려준다 */
  config: { workspacePath: string; projectName?: string; opencodeUrl: string }
  listener: ProjectSessionListener
  onHandshakeState: (state: SessionStatePayload['handshake']) => void
  onConnectionState: (state: SessionStatePayload['connection']) => void
  /** 없으면 런타임 생사 감지를 하지 않는다 (기존 동작) */
  liveness?: LivenessSink
  /** 확장이 채팅으로 물은 턴을 그 요청과 묶어 주는 자리 (`turnBinder.ts`). 없으면 안 묶는다. */
  binder?: TurnBinder
}

export interface WiredSession {
  /** 붙은 자리. 화면·진단이 host/port 모양을 기대해서 푼 값을 그대로 돌려준다. */
  endpoint: { host: string; port: number; source: string }
  connection: SessionConnection
  heartbeat: Heartbeat
  handshake: Handshake
  chat: ChatSession
  permission: PermissionModeController
  workingDir: WorkingDirController
  history: ChatHistoryController
  reviews: TurnReviewController
  mcp: McpConfigController
  llm: LlmConfigController
  notifications: NotificationController
}

export function wireSession(args: WireSessionArgs): WiredSession {
  const { config, listener } = args
  const endpoint = opencodeEndpoint(config.opencodeUrl)
  const connection = new OpencodeConnection({ baseUrl: `http://${endpoint.host}:${endpoint.port}` })
  // **와치독을 끈다 (watchdogMs: 0).**
  //
  // 이 와치독은 davis runtime 이 30초마다 보내는 ping 이 끊기는 것을 보는 장치다.
  // opencode 에는 ping/pong 자체가 없다 — SSE 하트비트는 `data:` 가 아닌 주석 줄(`: heartbeat`)
  // 이라 프레임으로 올라오지도 않는다. 켜 두면 90초마다 무조건 오발해 연결을 계속 재활용한다.
  // opencode 쪽 생사 신호는 SSE 스트림의 종료이며, 재연결은 SseStream 이 백오프로 스스로 한다.
  const heartbeat = new Heartbeat(connection, { watchdogMs: 0 })
  const chat = new ChatSession(connection, args.binder ? { binder: args.binder } : {})
  const permission = new PermissionModeController(connection)
  const workingDir = new WorkingDirController(connection)
  const history = new ChatHistoryController(connection)
  const reviews = new TurnReviewController(connection)
  const mcp = new McpConfigController(connection)
  const llm = new LlmConfigController(connection)
  const notifications = new NotificationController(connection)
  const handshake = new Handshake(connection, {
    workspacePath: config.workspacePath,
    ...(config.projectName ? { projectName: config.projectName } : {}),
  })

  handshake.onStateChange((state) => args.onHandshakeState(state))
  // 핸드셰이크가 ready 인 채로 소켓만 끊길 수 있다 — 그걸 화면이 알아야 한다
  connection.onStateChange((state) => args.onConnectionState(state))
  chat.onEvent((event) => listener.onTurnEvent(event))
  chat.onSnapshot((snapshot) => listener.onSnapshot(snapshot))
  permission.onChange((mode) => listener.onPermissionMode(mode))
  workingDir.onChange((state) => listener.onWorkingDir(state))
  // 연결이 끊기면 runtime 의 세션 메모리도 사라진다 — 옛 경로를 화면에 남기지 않는다
  connection.onStateChange((state) => {
    if (state !== 'open') workingDir.reset()
  })
  // adopt 한 runtime 은 프로세스 exit 을 받을 수 없어 소켓 생사가 유일한 단서다.
  // 와치독 타임아웃도 recycle → close 로 여기 모인다 (위 onWatchdogTimeout).
  // close 만으로 죽었다고 하지 않는다 — 확정은 헬스 확인을 거친다 (LivenessSink 주석).
  if (args.liveness) {
    const liveness = args.liveness
    connection.onClose(() => liveness.reportConnectionLost())
    connection.onOpen(() => liveness.reportConnectionRestored())
  }
  history.onStateChange((state) => listener.onHistoryState(state))
  // 발급받은 chat_id 를 ChatSession 에 심어 그 id 로 보낸다 (매 턴 새 이력 방지)
  history.onNewChatId((id) => chat.setChatId(id))
  // 재생 끝 — 인터럽트 억제를 푼다. 이후 도착하는 인터럽트는 라이브다 (vscode DC-866 미러)
  history.onLoadComplete(() => chat.endHistoryReplay())
  reviews.onChange((state) => listener.onReviewState(state))
  mcp.onChange((state) => listener.onMcpState(state))
  llm.onChange((state) => listener.onModelState(state))
  notifications.onNotification((n) => listener.onNotification(n))

  heartbeat.start()
  chat.start()
  permission.start()
  workingDir.start()
  history.start()
  reviews.start()
  mcp.start()
  llm.start()
  notifications.start()

  return {
    endpoint,
    connection,
    heartbeat,
    handshake,
    chat,
    permission,
    workingDir,
    history,
    reviews,
    mcp,
    llm,
    notifications,
  }
}
