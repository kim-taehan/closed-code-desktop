import { randomUUID } from 'node:crypto'
import { Action, AuthState, Kind, PermissionMode } from '../../shared/protocol/kinds'
import { parseInbound } from '../../shared/protocol/envelope'
import { HandlerSet, type CloseInfo, type Transport, type Unsubscribe } from '../ws/transport'
import { OpencodeClient } from './client'
import { replyApproval, replyUserAnswer } from './replies'
import { SessionModel, toModelRef } from './models'
import { applyPermissionMode } from './agents'
import { withPromptContext } from './promptContext'
import { SseStream } from './sse'
import { translate, type TranslateContext } from './translate'
import { syncWorkspace } from './workspace'
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
  /** 이 턴에 interrupt 를 보냈는가. `step.failed` 를 취소로 읽는 유일한 근거다. */
  private cancelling = false
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
        if (this.sessionId) await replyApproval(this.client, this.sessionId, data)
        return
      }
      if (kind === Kind.CHAT && action === Action.USER_ANSWER) {
        if (this.sessionId) await replyUserAnswer(this.client, this.sessionId, data)
        return
      }
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

  /** workspace_sync → opencode 세션 생성 (`workspace.ts`). 세션 id 를 붙잡는 것이 여기 몫이다. */
  private async onWorkspaceSync(data: Record<string, unknown>): Promise<void> {
    const result = await syncWorkspace(this.client, data, {
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.agent ? { agent: this.options.agent } : {}),
    })
    if (result.session) {
      this.sessionId = result.session.id
      this.model.adopt(result.session.model, result.session.directory)
    }
    this.emit(result.frame)
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
    // 붙인 문서·보는 파일은 글로 번역해 함께 보낸다 — 안 하면 사라진다 (`promptContext.ts`)
    const query = withPromptContext(typeof data['query'] === 'string' ? data['query'] : '', data)
    this.streamId = randomUUID()
    // 새 턴은 취소 기억 없이 시작한다. 앞 턴의 중단이 종료 이벤트를 못 받고 끝났을 때
    // (프롬프트 접수 직후 interrupt 는 opencode 가 아무 이벤트도 안 낸다 — 실측)
    // 플래그가 남아 다음 턴의 진짜 실패를 취소로 삼켜 버린다.
    this.cancelling = false
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

  /**
   * stream_cancel → `POST …/interrupt`.
   *
   * **조용히 버리지 않는다.** 세션이 없으면 보낼 곳이 없는데, 그냥 돌아서면 사용자에겐
   * "중단 버튼이 무시됐다" 로만 보인다. `fail()` 이 같은 사유로 이미 화면까지 올린다 —
   * 그 선례를 따른다 (열려 있는 턴도 stream_end 로 함께 닫는다).
   *
   * 성공 경로에서는 **중단을 요청했다는 사실을 기억한다.** opencode 는 중단된 턴을
   * `step.failed` 로 알리고, 그것이 사용자 취소인지 프로바이더 실패인지 구분해 주지
   * 않는다 — 가르는 근거가 이 플래그뿐이다 (`translate.ts` 의 STEP_FAILED 분기).
   */
  private async onCancel(): Promise<void> {
    const sessionId = this.sessionId
    if (!sessionId) {
      this.fail(Kind.CHAT, new Error('세션이 없어 중단 요청을 보내지 못했습니다'))
      return
    }
    this.cancelling = true
    await this.client.interrupt(sessionId)
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
    const context: TranslateContext = { streamId: this.streamId ?? 'no-stream', cancelling: this.cancelling }
    for (const frame of translate(event, context)) {
      if (this.streamId === null && frame['kind'] !== Kind.SYSTEM) continue
      this.emit(frame)
      // 턴이 닫히면 취소 기억도 함께 푼다 — 다음 턴의 진짜 실패를 취소로 오독하지 않도록.
      if (frame['action'] === Action.STREAM_END) {
        this.streamId = null
        this.cancelling = false
      }
    }
  }
}
