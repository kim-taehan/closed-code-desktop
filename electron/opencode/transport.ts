import { randomUUID } from 'node:crypto'
import { Action, AuthState, Kind, PermissionMode } from '../../shared/protocol/kinds'
import { parseInbound } from '../../shared/protocol/envelope'
import { HandlerSet, type CloseInfo, type Transport, type Unsubscribe } from '../ws/transport'
import { OpencodeClient } from './client'
import { chatHistoryFrame } from './chatHistory'
import { interruptTurn, sendChatRequest } from './chatRequest'
import { failureFrames, noSessionFrame } from './failFrames'
import { replyApproval, replyUserAnswer } from './replies'
import { SessionModel } from './models'
import { applyPermissionMode } from './agents'
import { mcpConfigFrame } from './mcpConfig'
import { nextSession, reusableSession, type SessionState } from './sessionSwitch'
import { SseStream } from './sse'
import { isErrorFrame, translate, type TranslateContext } from './translate'
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
  /** 세션이 선 프로젝트 디렉토리. MCP 질의가 프로젝트별이라 여기서도 붙잡는다 (`mcpConfig.ts`). */
  private directory: string | null = null
  private streamId: string | null = null
  /** 지금 세션에 아직 아무 말도 안 걸었는가. 「새 대화」가 세션을 또 만들지 않는 근거 (`chatHistory.ts`). */
  private emptySession = false
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
      if (kind === Kind.CHAT && action === Action.CHAT_REQUEST) return this.onChatRequest(data)
      if (kind === Kind.CHAT && action === Action.STREAM_CANCEL) return await this.onCancel()
      if (kind === Kind.CHAT && action === Action.TOOL_APPROVAL_RESPONSE) {
        if (this.sessionId) await replyApproval(this.client, this.sessionId, data)
        return
      }
      if (kind === Kind.CHAT && action === Action.USER_ANSWER) {
        if (this.sessionId) await replyUserAnswer(this.client, this.sessionId, data)
        return
      }
      if (kind === Kind.LLM_CONFIG && action === Action.LLM_CONFIG_STATUS) return await this.onLlmStatus()
      if (kind === Kind.WORKSPACE && action === Action.SET_PERMISSION_MODE) {
        return await this.onPermissionMode(data)
      }
      if (kind === Kind.MCP_CONFIG) {
        // 커넥터 다이얼로그. 번역과 실측 근거는 `mcpConfig.ts` 가 정본이다.
        const frame = await mcpConfigFrame(this.client, this.directory, action, data)
        if (frame) this.emit(frame)
        return
      }
      if (kind === Kind.CHAT_HISTORY) return await this.onChatHistory(action, data)
      // 나머지(ping/pong…)는 opencode 에 대응이 없다. 조용히 버린다.
    } catch (error) {
      this.fail(kind, error)
    }
  }

  /** 실패를 화면까지 올린다 (프레임 조립과 그 사유는 `failFrames.ts`). */
  private fail(kind: string, error: unknown): void {
    const cause = error instanceof Error ? error : new Error(String(error))
    this.errorHandlers.emit(cause)
    for (const frame of failureFrames(kind, cause.message, this.streamId)) this.emit(frame)
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
      this.directory = result.session.directory
      // 방금 만든 세션이다 — 곧 뒤따르는 「새 대화」 요청은 이걸 그대로 쓴다 (`chatHistory.ts`)
      this.emptySession = true
      this.model.adopt(result.session.model, result.session.directory)
    }
    this.emit(result.frame)
  }

  /** chat_request → prompt. 조립·모델 오버라이드와 그 근거는 `chatRequest.ts` 가 정본이다. */
  private onChatRequest(data: Record<string, unknown>): void {
    const sessionId = this.sessionId
    if (!sessionId) {
      this.emit(noSessionFrame())
      return
    }
    this.streamId = randomUUID()
    // 새 턴은 취소 기억 없이 시작한다. 앞 턴의 중단이 종료 이벤트를 못 받고 끝났을 때
    // (프롬프트 접수 직후 interrupt 는 opencode 가 아무 이벤트도 안 낸다 — 실측)
    // 플래그가 남아 다음 턴의 진짜 실패를 취소로 삼켜 버린다.
    this.cancelling = false
    this.emptySession = false // 이 세션엔 이제 말을 걸었다 — 「새 대화」는 새 세션을 받아야 한다
    this.emit({ kind: Kind.CHAT, action: Action.STREAM_START, data: {}, streamId: this.streamId })
    sendChatRequest(this.client, this.model, sessionId, data).catch((error: unknown) =>
      this.fail(Kind.CHAT, error),
    )
  }

  /**
   * 대화 이력. 봉투 번역은 `chatHistory.ts`, **세션 갈아타기는 `sessionSwitch.ts`** 가 정본이다.
   * 어느 쪽도 여기서 판단하지 않는다 — 여기는 어댑터의 상태를 읽어 주고 돌려받아 얹는다.
   */
  private async onChatHistory(action: string, data: Record<string, unknown>): Promise<void> {
    const state: SessionState = { sessionId: this.sessionId, emptySession: this.emptySession }
    const deps = {
      client: this.client,
      directory: this.directory,
      emptySession: reusableSession(state),
    }
    const next = await chatHistoryFrame(deps, action, data, (frame) => this.emit(frame))
    const after = nextSession(state, action, data, next)
    this.sessionId = after.sessionId
    this.emptySession = after.emptySession
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
    const mode = data['mode']
    if (this.sessionId) {
      this.permissionMode = await applyPermissionMode(
        this.client,
        this.sessionId,
        mode,
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
   * stream_cancel → 턴 중단. 보내는 일과 그 실측 근거는 `chatRequest.ts` 의 `interruptTurn` 이다.
   *
   * **조용히 버리지 않는다.** 세션이 없으면 보낼 곳이 없는데, 그냥 돌아서면 사용자에겐
   * "중단 버튼이 무시됐다" 로만 보인다. `fail()` 이 같은 사유로 이미 화면까지 올린다 —
   * 그 선례를 따른다 (열려 있는 턴도 stream_end 로 함께 닫는다).
   */
  private async onCancel(): Promise<void> {
    const sessionId = this.sessionId
    if (!sessionId) {
      this.fail(Kind.CHAT, new Error('세션이 없어 중단 요청을 보내지 못했습니다'))
      return
    }
    // 중단을 요청했다는 사실은 **여기가** 기억한다 — `translate.ts` 가 취소와 실패를 가르는
    // 근거이고, 왜 서버 이벤트로 못 가리는지는 `interruptTurn` 의 ⚠️ 절에 있다.
    this.cancelling = true
    await interruptTurn(this.client, sessionId)
  }

  /**
   * SSE 이벤트 처리.
   *
   * `/event` 는 **서버 전역**이라 다른 세션의 이벤트도 흘러온다. sessionID 가 실린 이벤트는
   * 우리 세션 것만 통과시킨다 — 안 거르면 다른 창의 대화가 이 화면에 섞여 렌더된다.
   * 없으면 통과시킨다(fail-open). 안전한 근거는 종료 신호(`session.idle`·`session.error`)도
   * sessionID 를 싣는다는 실측이다 — 안 실었다면 남의 idle 이 내 턴을 닫는다.
   */
  private onEvent(event: OpencodeEvent): void {
    const eventSession = (event.properties as Record<string, unknown> | undefined)?.['sessionID']
    if (typeof eventSession === 'string' && this.sessionId && eventSession !== this.sessionId) return

    // 턴이 없는 동안 온 스트림 프레임은 버린다 — system 과 **오류**만 통과시킨다.
    // 없으면 종료 신호가 겹칠 때 stream_end 가 두 번 나가 이미 닫힌 턴을 또 닫는다
    // (겹침은 실측 — `translate.ts` 의 SESSION_IDLE 분기. 오류를 빼 두는 이유는 `isErrorFrame`).
    const context: TranslateContext = { streamId: this.streamId ?? 'no-stream', cancelling: this.cancelling }
    for (const frame of translate(event, context)) {
      if (this.streamId === null && frame['kind'] !== Kind.SYSTEM && !isErrorFrame(frame)) continue
      this.emit(frame)
      // 턴이 닫히면 취소 기억도 함께 푼다 — 다음 턴의 진짜 실패를 취소로 오독하지 않도록.
      if (frame['action'] === Action.STREAM_END) {
        this.streamId = null
        this.cancelling = false
      }
    }
  }
}
