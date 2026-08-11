import { randomUUID } from 'node:crypto'
import { Action, AuthState, Kind, PermissionMode, WorkspaceState } from '../../shared/protocol/kinds'
import { parseInbound } from '../../shared/protocol/envelope'
import { HandlerSet, type CloseInfo, type Transport, type Unsubscribe } from '../ws/transport'
import { OpencodeClient, type PermissionReply } from './client'
import { SessionModel, toModelRef } from './models'
import { applyPermissionMode } from './agents'
import { SseStream } from './sse'
import { translate, type TranslateContext } from './translate'
import type { OpencodeEvent } from './events'

// `Transport` 의 opencode 구현 — 부패방지 계층.
//
// 위층(session/*)은 davis 봉투만 안다. 여기서 양방향으로 번역한다:
//   나가는 davis 프레임 → opencode HTTP 호출
//   들어오는 opencode SSE 이벤트 → davis 봉투 (translate.ts)
//
// opencode 에 없는 개념(라이선스 인증)은 **합성해서 통과시킨다**. 핸드셰이크 4단계는
// 위층의 상태머신이라 없앨 수 없고, 없애면 핸드셰이크가 그 자리에서 멈춘다.

export interface OpencodeTransportOptions {
  baseUrl: string
  password?: string
  model?: { id: string; providerID: string }
  agent?: string
  fetchImpl?: typeof fetch
  autoReconnect?: boolean
}

export class OpencodeTransport implements Transport {
  private readonly client: OpencodeClient
  private readonly model: SessionModel
  protected readonly sse: SseStream
  private sessionId: string | null = null
  private streamId: string | null = null
  private started = false
  /** 세션에 실제로 걸린 권한 모드. 요청이 거절되면 이 값이 화면을 되돌린다. */
  private permissionMode: PermissionMode = PermissionMode.DEFAULT

  private readonly openHandlers = new HandlerSet<[]>()
  private readonly messageHandlers = new HandlerSet<[string]>()
  private readonly closeHandlers = new HandlerSet<[CloseInfo]>()
  private readonly errorHandlers = new HandlerSet<[Error]>()

  constructor(private readonly options: OpencodeTransportOptions) {
    const clientOptions = {
      baseUrl: options.baseUrl,
      ...(options.password !== undefined ? { password: options.password } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    }
    this.client = new OpencodeClient(clientOptions)
    this.model = new SessionModel(this.client)
    this.sse = new SseStream({
      url: this.client.eventUrl,
      headers: this.client.headers,
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.autoReconnect !== undefined ? { autoReconnect: options.autoReconnect } : {}),
    })

    this.sse.onOpen(() => {
      this.started = true
      this.openHandlers.emit()
    })
    this.sse.onEvent((event) => this.onEvent(event))
    this.sse.onError((error) => this.errorHandlers.emit(error))
    this.sse.onClose(() => {
      this.started = false
      this.closeHandlers.emit({ code: 1006, reason: 'opencode SSE 연결이 끊겼습니다' })
    })
  }

  get isOpen(): boolean {
    return this.started
  }

  /** SSE 스트림을 연다. 열릴 때까지 기다리는 것은 OpencodeConnection 몫이다. */
  open(): void {
    this.sse.start()
  }

  onOpen(handler: () => void): Unsubscribe {
    return this.openHandlers.add(handler)
  }
  onMessage(handler: (raw: string) => void): Unsubscribe {
    return this.messageHandlers.add(handler)
  }
  onClose(handler: (info: CloseInfo) => void): Unsubscribe {
    return this.closeHandlers.add(handler)
  }
  onError(handler: (error: Error) => void): Unsubscribe {
    return this.errorHandlers.add(handler)
  }

  close(): void {
    this.sse.close()
  }

  send(payload: string): boolean {
    if (!this.started) return false
    const frame = parseInbound(payload)
    if (!frame) return false
    void this.dispatch(frame.kind, frame.action, (frame.data ?? {}) as Record<string, unknown>)
    return true
  }

  /** 위층으로 davis 봉투를 밀어 넣는다 */
  private emit(frame: Record<string, unknown>): void {
    this.messageHandlers.emit(JSON.stringify(frame))
  }

  private async dispatch(kind: string, action: string, data: Record<string, unknown>): Promise<void> {
    try {
      if (kind === Kind.AUTH && action === Action.AUTH_REQUEST) return this.onAuthRequest()
      if (kind === Kind.WORKSPACE && action === Action.WORKSPACE_SYNC) {
        return await this.onWorkspaceSync(data)
      }
      if (kind === Kind.CHAT && action === Action.CHAT_REQUEST) return await this.onChatRequest(data)
      if (kind === Kind.CHAT && action === Action.STREAM_CANCEL) return await this.onCancel()
      if (kind === Kind.CHAT && action === Action.TOOL_APPROVAL_RESPONSE) {
        return await this.onApproval(data)
      }
      if (kind === Kind.CHAT && action === Action.USER_ANSWER) return await this.onUserAnswer(data)
      if (kind === Kind.LLM_CONFIG && action === Action.LLM_CONFIG_STATUS) {
        return await this.onLlmStatus()
      }
      if (kind === Kind.WORKSPACE && action === Action.SET_PERMISSION_MODE) {
        return await this.onPermissionMode(data)
      }
      // 나머지(ping/pong·mcp_config…)는 opencode 에 대응이 없다. 조용히 버린다.
    } catch (error) {
      this.fail(kind, error)
    }
  }

  /**
   * 실패를 **화면까지** 올린다.
   *
   * onError 로만 알리면 아무도 듣지 않는 자리에서 사라진다. 실제로 세션 생성이 조용히
   * 실패했을 때 증상이 "핸드셰이크는 ready 인데 채팅 무응답" 으로만 나타나 추적이 어려웠다.
   * 진행 중인 턴이 있으면 stream_end 까지 내려 진행 표시기가 영원히 돌지 않게 한다.
   */
  private fail(kind: string, error: unknown): void {
    const cause = error instanceof Error ? error : new Error(String(error))
    this.errorHandlers.emit(cause)
    this.emit({ kind, action: Action.ERROR, data: { code: 'OPENCODE_ERROR', message: cause.message } })
    if (this.streamId) {
      this.emit({
        kind: Kind.CHAT,
        action: Action.STREAM_END,
        data: { failed: true, errorCode: 'OPENCODE_ERROR' },
        streamId: this.streamId,
      })
    }
  }

  /**
   * opencode 에는 라이선스 개념이 없다 — 항상 valid 로 답한다.
   *
   * 실측 함정을 그대로 재현한다: runtime 은 인증 결과를 `auth_state` 가 아니라 요청 action 을
   * 에코한 `auth_request` 로 돌려준다(handshake.ts 주석). 위층은 payload 모양(`state` 유무)으로
   * 판정하므로 어느 쪽이든 통과하지만, 정본 action 을 쓴다.
   */
  private onAuthRequest(): void {
    this.emit({ kind: Kind.AUTH, action: Action.AUTH_STATE, data: { state: AuthState.VALID } })
  }

  /** workspace_sync → opencode 세션 생성. directory 가 곧 워크스페이스다. */
  private async onWorkspaceSync(data: Record<string, unknown>): Promise<void> {
    const workspace = (data['workspace'] ?? {}) as Record<string, unknown>
    const directory = typeof workspace['workspacePath'] === 'string' ? workspace['workspacePath'] : ''
    if (!directory) {
      this.emit({
        kind: Kind.WORKSPACE,
        action: Action.ERROR,
        data: { code: 'NO_WORKSPACE', message: 'workspacePath 가 비어 있습니다' },
      })
      return
    }
    const session = await this.client.createSession({
      directory,
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.agent ? { agent: this.options.agent } : {}),
    })
    this.sessionId = session.id
    this.model.adopt(session.model)
    this.emit({
      kind: Kind.WORKSPACE,
      action: Action.WORKSPACE_STATE,
      data: { state: WorkspaceState.READY },
    })
  }

  /**
   * chat_request → prompt.
   *
   * **`prompt` 를 await 하지 않는다.** 이 호출은 턴이 끝나야 돌아오므로 await 하면
   * 그동안 도착하는 취소·승인 프레임을 처리할 수 없다. 화면 갱신은 SSE 가 한다.
   */
  private async onChatRequest(data: Record<string, unknown>): Promise<void> {
    const sessionId = this.sessionId
    if (!sessionId) {
      this.emit({
        kind: Kind.CHAT,
        action: Action.ERROR,
        data: { code: 'NO_SESSION', message: '세션이 아직 없습니다 (workspace_sync 선행 필요)' },
      })
      return
    }
    const query = typeof data['query'] === 'string' ? data['query'] : ''
    this.streamId = randomUUID()
    this.emit({ kind: Kind.CHAT, action: Action.STREAM_START, data: {}, streamId: this.streamId })

    // 모델 오버라이드는 **보내기 직전에** 세션에 건다. davis 는 요청마다 실어 보냈고
    // runtime 이 기억하지 않았지만, opencode 의 모델은 세션에 남는다 — 그래서 오버라이드가
    // 빠진 요청에서는 기본 모델로 되돌린다. 안 되돌리면 한 번 고른 모델이 영영 붙는다.
    const requested = typeof data['model'] === 'string' ? toModelRef(data['model']) : null
    this.model
      .apply(sessionId, requested)
      .then(() => this.client.prompt(sessionId, query))
      .catch((error: unknown) => this.fail(Kind.CHAT, error))
  }

  /** 모델 스위처가 목록을 물었다 (davis 는 status → models 두 왕복이었다 — `models.ts`). */
  private async onLlmStatus(): Promise<void> {
    this.emit({
      kind: Kind.LLM_CONFIG,
      action: Action.LLM_CONFIG_STATUS,
      data: await this.model.status(),
    })
  }

  /** 권한 모드 → 에이전트. **걸린 값을 되돌려 보낸다** (`agents.ts` 머리말). */
  private async onPermissionMode(data: Record<string, unknown>): Promise<void> {
    if (this.sessionId) {
      this.permissionMode = await applyPermissionMode(
        this.client,
        this.sessionId,
        data['mode'],
        this.permissionMode,
      )
    }
    this.emit({
      kind: Kind.WORKSPACE,
      action: Action.PERMISSION_MODE_CHANGED,
      data: { mode: this.permissionMode },
    })
  }

  private async onCancel(): Promise<void> {
    if (this.sessionId) await this.client.interrupt(this.sessionId)
  }

  /**
   * 승인 응답 매핑.
   *   거부                        → reject
   *   승인 + session/local_allow  → always  (opencode 는 범위 구분이 없다 — 둘 다 always)
   *   승인만                      → once
   */
  private async onApproval(data: Record<string, unknown>): Promise<void> {
    if (!this.sessionId) return
    const requestId = typeof data['requestId'] === 'string' ? data['requestId'] : ''
    if (!requestId) return
    const approved = data['approved'] === true
    const followUp = data['followUp']
    const reply: PermissionReply = !approved ? 'reject' : followUp ? 'always' : 'once'
    await this.client.replyPermission(this.sessionId, requestId, reply)
  }

  private async onUserAnswer(data: Record<string, unknown>): Promise<void> {
    if (!this.sessionId) return
    const questionId = typeof data['questionId'] === 'string' ? data['questionId'] : ''
    if (!questionId) return
    const answer = typeof data['answer'] === 'string' ? data['answer'] : null
    await this.client.replyQuestion(this.sessionId, questionId, answer)
  }

  /**
   * SSE 이벤트 처리.
   *
   * `/event` 는 **서버 전역**이라 다른 세션의 이벤트도 흘러온다. sessionID 가 실린 이벤트는
   * 우리 세션 것만 통과시킨다 — 안 거르면 다른 창의 대화가 이 화면에 섞여 렌더된다.
   */
  private onEvent(event: OpencodeEvent): void {
    const eventSession = (event.properties as Record<string, unknown> | undefined)?.['sessionID']
    if (typeof eventSession === 'string' && this.sessionId && eventSession !== this.sessionId) return

    // 턴이 없는 동안 도착한 스트림 이벤트는 버린다. 핸드셰이크용 system 프레임만 통과시킨다.
    // 이 가드가 없으면 종료 신호가 둘(step.ended·session.idle) 다 왔을 때 stream_end 가
    // 두 번 나가 위층의 턴 게이트가 이미 닫힌 턴을 또 닫는다.
    const context: TranslateContext = { streamId: this.streamId ?? 'no-stream' }
    for (const frame of translate(event, context)) {
      if (this.streamId === null && frame['kind'] !== Kind.SYSTEM) continue
      this.emit(frame)
      if (frame['action'] === Action.STREAM_END) this.streamId = null
    }
  }
}
