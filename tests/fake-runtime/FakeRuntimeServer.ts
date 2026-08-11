// 설계 §4 의 runtime WebSocket 계약을 재생하는 테스트 더블.
// 실제 runtime 없이 핸드셰이크·하트비트·턴 스트림·승인 재개를 검증하기 위한 기반이다.
//
// 계약의 함정을 "일부러" 재현한다:
//  - auth 이전의 다른 kind 는 AUTH_REQUIRED 로 거부 (base_service.py:96-112)
//  - workspace_sync 이전의 chat_request 는 AUTH_REQUIRED 로 거부 (chat_service.py:873-876)
//  - workspacePath 를 snake_case 로 보내면 필수 필드 누락으로 취급

import { WebSocketServer, type WebSocket } from 'ws'
import type { Server } from 'node:http'
import { startHealthServer, stopHealthServer } from './fakeHealthServer'
import { Action, AuthState, Kind, WorkspaceState } from '../../shared/protocol/kinds'
import type { ServerFrame } from './turnScript'
import { buildChatHistoryReply } from './fakeChatHistory'
import { buildTurnDecisionReply } from './fakeTurnReview'

export interface FakeRuntimeOptions {
  /** auth_request 에 돌려줄 상태. 기본 valid */
  authState?: AuthState
  /**
   * 인증 응답의 action. 기본은 실측값인 'auth_request'(요청 action 에코)다.
   * 문서상으로는 'auth_state' 라서, 클라이언트가 둘 다 견디는지 확인하려고 열어둔다.
   */
  authReplyAction?: typeof Action.AUTH_REQUEST | typeof Action.AUTH_STATE
  /** ping 주기(ms). 0 이면 ping 을 보내지 않는다. 기본 0 */
  pingIntervalMs?: number
  /** chat_request 를 받았을 때 돌려줄 프레임을 만드는 함수. 기본은 응답 없음 */
  onChatRequest?: (context: ChatRequestContext) => ServerFrame[]
  /** tool_approval_response 를 받았을 때 돌려줄 프레임 */
  onApprovalResponse?: (context: ApprovalContext) => ServerFrame[]
  /** 초기 이력 목록 (snake_case 그대로) */
  history?: Record<string, unknown>[]
  /** chat_history_load 시 다시 흘려보낼 프레임 */
  onHistoryLoad?: (chatId: string) => ServerFrame[]
}

export interface ChatRequestContext {
  reqId: string
  chatId: string
  streamId: string
  query: string
}

export interface ApprovalContext {
  reqId: string
  chatId: string
  requestId: string
  approved: boolean
}

export interface ReceivedFrame {
  kind: string
  action: string
  reqId?: string
  ping_id?: string
  data?: Record<string, unknown>
  raw: Record<string, unknown>
}

export class FakeRuntimeServer {
  private server: WebSocketServer | null = null
  /** WS 와 같은 포트에서 /health 를 준다 — 실제 runtime 이 그렇다 */
  private http: Server | null = null
  private sockets = new Set<WebSocket>()
  private pingTimer: NodeJS.Timeout | null = null
  private streamCounter = 0

  /** 수신한 모든 프레임. 테스트가 순서를 단언한다. */
  readonly received: ReceivedFrame[] = []
  /** 클라이언트가 회신한 pong 의 ping_id 목록 */
  readonly pongIds: string[] = []
  /** 연결 시 붙은 csid 쿼리 값 */
  readonly connectedCsids: string[] = []

  constructor(private readonly options: FakeRuntimeOptions = {}) {
    this.history = options.history ? options.history.map((entry) => ({ ...entry })) : []
  }

  async start(): Promise<number> {
    const health = await startHealthServer()
    this.http = health.server
    this.server = new WebSocketServer({ server: this.http })
    this.server.on('connection', (socket, request) => this.handleConnection(socket, request.url))

    const interval = this.options.pingIntervalMs ?? 0
    if (interval > 0) {
      this.pingTimer = setInterval(() => this.sendPing(), interval)
    }
    return health.port
  }

  async stop(): Promise<void> {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    for (const socket of this.sockets) socket.terminate()
    this.sockets.clear()
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    this.server = null
    await stopHealthServer(this.http)
    this.http = null
  }

  /** 진행 중인 소켓에 임의 프레임을 밀어넣는다. 승인 재개 등 비동기 푸시에 쓴다. */
  push(frames: ServerFrame[]): void {
    for (const socket of this.sockets) {
      for (const frame of frames) socket.send(JSON.stringify(frame))
    }
  }

  sendPing(pingId = `ping${this.received.length}`): void {
    for (const socket of this.sockets) {
      socket.send(JSON.stringify({ kind: Kind.SYSTEM, action: Action.PING, ping_id: pingId }))
    }
  }

  private handleConnection(socket: WebSocket, url: string | undefined): void {
    this.sockets.add(socket)
    this.connectedCsids.push(new URLSearchParams(url?.split('?')[1] ?? '').get('csid') ?? '')
    socket.on('close', () => this.sockets.delete(socket))
    socket.on('message', (raw) => this.handleMessage(socket, raw.toString()))

    // 2단계: 요청 없이 서버가 먼저 보낸다 (websocket_manager.py:217-218)
    this.send(socket, {
      kind: Kind.SYSTEM,
      action: Action.CONNECTED,
      data: { sessionId: 'fake-session', timestamp: new Date(0).toISOString() },
    })
  }

  /** 세션별 상태. 소켓 하나만 다루는 테스트 더블이라 서버 단위로 들고 있다. */
  private authenticated = false
  private workspaceReady = false
  private history: Record<string, unknown>[] = []

  private handleMessage(socket: WebSocket, raw: string): void {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }

    const kind = String(parsed['kind'] ?? '')
    const action = String(parsed['action'] ?? '')
    const reqId = parsed['reqId'] as string | undefined
    const data = parsed['data'] as Record<string, unknown> | undefined

    this.received.push({ kind, action, reqId, ping_id: parsed['ping_id'] as string | undefined, data, raw: parsed })

    if (kind === Kind.SYSTEM && action === Action.PONG) {
      this.pongIds.push(String(parsed['ping_id'] ?? ''))
      return
    }

    // runtime 은 reqId 를 기본값 없이 필수로 받는다 (protocol.py:151-159)
    if (!reqId) {
      this.send(socket, { kind, action: Action.ERROR, data: { code: 'VALIDATION_ERROR', message: 'reqId 필수' } })
      return
    }

    if (kind === Kind.AUTH && action === Action.AUTH_REQUEST) return this.handleAuth(socket, reqId)
    if (!this.authenticated) return this.rejectUnauthenticated(socket)
    if (kind === Kind.WORKSPACE && action === Action.WORKSPACE_SYNC) return this.handleWorkspaceSync(socket, reqId, data)
    if (kind === Kind.CHAT && action === Action.CHAT_REQUEST) return this.handleChatRequest(socket, reqId, parsed, data)
    if (kind === Kind.CHAT && action === Action.TOOL_APPROVAL_RESPONSE) {
      return this.handleApproval(socket, reqId, parsed, data)
    }
    if (kind === Kind.WORKSPACE && action === Action.SET_PERMISSION_MODE) {
      return this.handlePermissionMode(socket, reqId, data)
    }
    if (kind === Kind.DIFF) {
      for (const frame of buildTurnDecisionReply(action, reqId, data)) this.send(socket, frame)
      return
    }
    if (kind === Kind.CHAT_HISTORY) {
      const frames = buildChatHistoryReply({
        action,
        reqId,
        data,
        history: this.history,
        onHistoryLoad: this.options.onHistoryLoad,
      })
      for (const frame of frames) this.send(socket, frame)
      return
    }
  }

  private handleAuth(socket: WebSocket, reqId: string): void {
    const state = this.options.authState ?? AuthState.VALID
    this.send(socket, { kind: Kind.AUTH, action: Action.ACK, replyTo: reqId, data: {} })
    this.authenticated = state === AuthState.VALID
    // 실측: runtime 3.4.3 은 요청 action 을 그대로 에코한다 (auth_state 가 아님)
    this.send(socket, {
      kind: Kind.AUTH,
      action: this.options.authReplyAction ?? Action.AUTH_REQUEST,
      replyTo: reqId,
      data: { state, message: `상태: ${state}`, authErrorCode: null },
    })
  }

  private rejectUnauthenticated(socket: WebSocket): void {
    this.send(socket, {
      kind: Kind.AUTH,
      action: Action.AUTH_STATE,
      data: { state: AuthState.INVALID, authErrorCode: 'AUTH_REQUIRED', message: '인증이 필요합니다' },
    })
  }

  private handleWorkspaceSync(socket: WebSocket, reqId: string, data?: Record<string, unknown>): void {
    const workspace = data?.['workspace'] as Record<string, unknown> | undefined
    // 별칭이 걸린 필드라 camelCase 로만 받는다. snake_case 는 필수 필드 누락이 된다.
    if (!workspace || typeof workspace['workspacePath'] !== 'string') {
      this.send(socket, {
        kind: Kind.WORKSPACE,
        action: Action.ERROR,
        replyTo: reqId,
        data: { code: 'VALIDATION_ERROR', message: 'workspacePath 필수' },
      })
      return
    }
    this.send(socket, { kind: Kind.WORKSPACE, action: Action.ACK, replyTo: reqId, data: {} })
    this.send(socket, {
      kind: Kind.WORKSPACE,
      action: Action.WORKSPACE_STATE,
      replyTo: reqId,
      data: { state: WorkspaceState.NOT_READY },
    })
    this.workspaceReady = true
    this.send(socket, {
      kind: Kind.WORKSPACE,
      action: Action.WORKSPACE_STATE,
      replyTo: reqId,
      data: { state: WorkspaceState.READY, workspacePath: 'ws-1' },
    })
  }

  private handleChatRequest(
    socket: WebSocket,
    reqId: string,
    parsed: Record<string, unknown>,
    data?: Record<string, unknown>,
  ): void {
    // workspace_sync 없이 온 chat_request 는 조용히 죽는다 (chat_service.py:873-876)
    if (!this.workspaceReady) return this.rejectUnauthenticated(socket)

    const chatId = (parsed['chatId'] as string | undefined) ?? 'fake-chat'
    const streamId = `stream-${++this.streamCounter}`
    const frames =
      this.options.onChatRequest?.({ reqId, chatId, streamId, query: String(data?.['query'] ?? '') }) ?? []
    for (const frame of frames) this.send(socket, frame)
  }

  private handleApproval(
    socket: WebSocket,
    reqId: string,
    parsed: Record<string, unknown>,
    data?: Record<string, unknown>,
  ): void {
    const frames =
      this.options.onApprovalResponse?.({
        reqId,
        chatId: (parsed['chatId'] as string | undefined) ?? 'fake-chat',
        requestId: String(data?.['requestId'] ?? ''),
        approved: data?.['approved'] === true,
      }) ?? []
    this.send(socket, { kind: Kind.CHAT, action: Action.ACK, replyTo: reqId, data: {} })
    for (const frame of frames) this.send(socket, frame)
  }

  /** runtime 은 세 값만 받는다. 그 외는 BAD_REQUEST 로 거부한다. */
  private handlePermissionMode(socket: WebSocket, reqId: string, data?: Record<string, unknown>): void {
    const mode = data?.['mode']
    if (mode !== 'default' && mode !== 'plan' && mode !== 'acceptEdits') {
      this.send(socket, {
        kind: Kind.WORKSPACE,
        action: Action.ERROR,
        replyTo: reqId,
        data: { code: 'BAD_REQUEST', message: `유효하지 않은 PermissionMode: ${String(mode)}` },
      })
      return
    }
    this.send(socket, { kind: Kind.WORKSPACE, action: Action.ACK, replyTo: reqId, data: {} })
    // 실측: 실제 runtime 은 사람이 읽을 message 도 함께 보낸다
    this.send(socket, {
      kind: Kind.WORKSPACE,
      action: Action.PERMISSION_MODE_CHANGED,
      replyTo: reqId,
      data: { mode, message: `${mode} 모드로 전환되었습니다.` },
    })
  }

  private send(socket: WebSocket, frame: ServerFrame): void {
    socket.send(JSON.stringify(frame))
  }
}
