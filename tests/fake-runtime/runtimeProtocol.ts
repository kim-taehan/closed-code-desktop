// 설계 §4 의 runtime **프레임 계약**을 재생하는 테스트 더블.
// 실제 runtime 없이 핸드셰이크·하트비트·턴 스트림·승인 재개를 검증하기 위한 기반이다.
//
// 계약의 함정을 "일부러" 재현한다:
//  - auth 이전의 다른 kind 는 AUTH_REQUIRED 로 거부 (base_service.py:96-112)
//  - workspace_sync 이전의 chat_request 는 AUTH_REQUIRED 로 거부 (chat_service.py:873-876)
//  - workspacePath 를 snake_case 로 보내면 필수 필드 누락으로 취급
//
// **여기에는 전송이 없다 (2026-08-26).** 원래는 `FakeRuntimeServer` 라는 진짜
// WebSocket 서버였고 이 상태기계가 그 안에 들어 있었다. 앱이 opencode(HTTP+SSE)로
// 옮겨가면서 davis WS 를 여는 곳이 프로덕션에서 사라졌고, 소켓을 띄우는 부분만
// 죽은 잔재가 됐다 — 그 아래 **프레임 계약을 겨누던 시험들은 죽지 않았다.**
// 그래서 상태기계만 떼어 남기고, 구동은 `MemoryConnection`(`Transport` 인메모리 대역)이
// 맡는다. 재던 것이 무엇인지는 그대로다: 프레임이 오갈 때 세션 계층이 어떻게 구는가.

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

export class FakeRuntimeProtocol {
  /** 수신한 모든 프레임. 테스트가 순서를 단언한다. */
  readonly received: ReceivedFrame[] = []
  /** 클라이언트가 회신한 pong 의 ping_id 목록 */
  readonly pongIds: string[] = []

  private authenticated = false
  private workspaceReady = false
  private history: Record<string, unknown>[] = []
  private streamCounter = 0

  constructor(
    private readonly options: FakeRuntimeOptions = {},
    /** 프레임을 클라이언트 쪽으로 내보내는 자리. 전송 수단은 이 클래스가 모른다. */
    private readonly emit: (frame: ServerFrame) => void = () => {},
  ) {
    this.history = options.history ? options.history.map((entry) => ({ ...entry })) : []
  }

  /** 붙는 순간 서버가 **요청 없이 먼저** 보낸다 (websocket_manager.py:217-218) */
  greet(): void {
    this.emit({
      kind: Kind.SYSTEM,
      action: Action.CONNECTED,
      data: { sessionId: 'fake-session', timestamp: new Date(0).toISOString() },
    })
  }

  sendPing(pingId = `ping${this.received.length}`): void {
    this.emit({ kind: Kind.SYSTEM, action: Action.PING, ping_id: pingId } as unknown as ServerFrame)
  }

  /** 요청과 무관하게 임의 프레임을 밀어넣는다. 승인 재개 등 비동기 푸시에 쓴다. */
  push(frames: ServerFrame[]): void {
    for (const frame of frames) this.emit(frame)
  }

  handle(raw: string): void {
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
      this.emit({ kind, action: Action.ERROR, data: { code: 'VALIDATION_ERROR', message: 'reqId 필수' } })
      return
    }

    if (kind === Kind.AUTH && action === Action.AUTH_REQUEST) return this.handleAuth(reqId)
    if (!this.authenticated) return this.rejectUnauthenticated()
    if (kind === Kind.WORKSPACE && action === Action.WORKSPACE_SYNC) return this.handleWorkspaceSync(reqId, data)
    if (kind === Kind.CHAT && action === Action.CHAT_REQUEST) return this.handleChatRequest(reqId, parsed, data)
    if (kind === Kind.CHAT && action === Action.TOOL_APPROVAL_RESPONSE) {
      return this.handleApproval(reqId, parsed, data)
    }
    if (kind === Kind.WORKSPACE && action === Action.SET_PERMISSION_MODE) {
      return this.handlePermissionMode(reqId, data)
    }
    if (kind === Kind.DIFF) {
      for (const frame of buildTurnDecisionReply(action, reqId, data)) this.emit(frame)
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
      for (const frame of frames) this.emit(frame)
      return
    }
  }

  private handleAuth(reqId: string): void {
    const state = this.options.authState ?? AuthState.VALID
    this.emit({ kind: Kind.AUTH, action: Action.ACK, replyTo: reqId, data: {} })
    this.authenticated = state === AuthState.VALID
    // 실측: runtime 3.4.3 은 요청 action 을 그대로 에코한다 (auth_state 가 아님)
    this.emit({
      kind: Kind.AUTH,
      action: this.options.authReplyAction ?? Action.AUTH_REQUEST,
      replyTo: reqId,
      data: { state, message: `상태: ${state}`, authErrorCode: null },
    })
  }

  private rejectUnauthenticated(): void {
    this.emit({
      kind: Kind.AUTH,
      action: Action.AUTH_STATE,
      data: { state: AuthState.INVALID, authErrorCode: 'AUTH_REQUIRED', message: '인증이 필요합니다' },
    })
  }

  private handleWorkspaceSync(reqId: string, data?: Record<string, unknown>): void {
    const workspace = data?.['workspace'] as Record<string, unknown> | undefined
    // 별칭이 걸린 필드라 camelCase 로만 받는다. snake_case 는 필수 필드 누락이 된다.
    if (!workspace || typeof workspace['workspacePath'] !== 'string') {
      this.emit({
        kind: Kind.WORKSPACE,
        action: Action.ERROR,
        replyTo: reqId,
        data: { code: 'VALIDATION_ERROR', message: 'workspacePath 필수' },
      })
      return
    }
    this.emit({ kind: Kind.WORKSPACE, action: Action.ACK, replyTo: reqId, data: {} })
    this.emit({
      kind: Kind.WORKSPACE,
      action: Action.WORKSPACE_STATE,
      replyTo: reqId,
      data: { state: WorkspaceState.NOT_READY },
    })
    this.workspaceReady = true
    this.emit({
      kind: Kind.WORKSPACE,
      action: Action.WORKSPACE_STATE,
      replyTo: reqId,
      data: { state: WorkspaceState.READY, workspacePath: 'ws-1' },
    })
  }

  private handleChatRequest(reqId: string, parsed: Record<string, unknown>, data?: Record<string, unknown>): void {
    // workspace_sync 없이 온 chat_request 는 조용히 죽는다 (chat_service.py:873-876)
    if (!this.workspaceReady) return this.rejectUnauthenticated()

    const chatId = (parsed['chatId'] as string | undefined) ?? 'fake-chat'
    const streamId = `stream-${++this.streamCounter}`
    const frames =
      this.options.onChatRequest?.({ reqId, chatId, streamId, query: String(data?.['query'] ?? '') }) ?? []
    for (const frame of frames) this.emit(frame)
  }

  private handleApproval(reqId: string, parsed: Record<string, unknown>, data?: Record<string, unknown>): void {
    const frames =
      this.options.onApprovalResponse?.({
        reqId,
        chatId: (parsed['chatId'] as string | undefined) ?? 'fake-chat',
        requestId: String(data?.['requestId'] ?? ''),
        approved: data?.['approved'] === true,
      }) ?? []
    this.emit({ kind: Kind.CHAT, action: Action.ACK, replyTo: reqId, data: {} })
    for (const frame of frames) this.emit(frame)
  }

  /** runtime 은 세 값만 받는다. 그 외는 BAD_REQUEST 로 거부한다. */
  private handlePermissionMode(reqId: string, data?: Record<string, unknown>): void {
    const mode = data?.['mode']
    if (mode !== 'default' && mode !== 'plan' && mode !== 'acceptEdits') {
      this.emit({
        kind: Kind.WORKSPACE,
        action: Action.ERROR,
        replyTo: reqId,
        data: { code: 'BAD_REQUEST', message: `유효하지 않은 PermissionMode: ${String(mode)}` },
      })
      return
    }
    this.emit({ kind: Kind.WORKSPACE, action: Action.ACK, replyTo: reqId, data: {} })
    // 실측: 실제 runtime 은 사람이 읽을 message 도 함께 보낸다
    this.emit({
      kind: Kind.WORKSPACE,
      action: Action.PERMISSION_MODE_CHANGED,
      replyTo: reqId,
      data: { mode, message: `${mode} 모드로 전환되었습니다.` },
    })
  }
}
