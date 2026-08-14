import { dispatchChatFrame } from './frameDispatch'
import { createResponder, type ChatResponder } from './chatResponses'
import { cancelFrame, chatRequestFrame, type ApprovalFollowUp } from './chatFrames'
import type { ChatSendContext } from '../../shared/ipc/chatPayloads'
import type { TurnEvent } from '../../shared/ipc/channels'
import type { ChatMessage, TurnMeta } from '../../shared/ipc/messageTypes'
import { HandlerSet, type Transport, type Unsubscribe } from '../ws/transport'
import { ChunkRouter, type RouteEffect } from './chunkRouter'
import { interruptTurnEvents } from './interrupts'
import { MessageStore } from './messageStore'
import { TurnMetaStore } from './turnMeta'
import { TurnGate } from './turnGate'
import type { TurnBinder } from './turnBinder'
import { emitRouteEffect } from './routeEffects'
import { ReplyWatch } from './replyWatch'
import { ReplayGate } from './replayGate'
import { AgentTaskStore } from './agentTaskStore'
import type { AgentTask } from '../../shared/ipc/agentTask'

// 채팅 세션의 수명과 전송을 책임진다.
// **청크 해석은 하지 않는다** — ChunkRouter 가 유일한 해석기다 (설계 §5).
// 여기서 청크를 다시 읽으면 해석기가 둘이 되어 서로 어긋난다.

export interface ChatSessionOptions {
  /** 승인 요청이 왔을 때 자동 승인할지. 기본 false — 사용자에게 묻는다. */
  autoApprove?: boolean
  /** 확장이 보낸 턴을 그 요청과 묶어 주는 자리 (`turnBinder.ts`). 없으면 아무 일도 안 한다. */
  binder?: TurnBinder
}

export interface ChatSnapshot {
  messages: ChatMessage[]
  turnMetas: TurnMeta[]
  /** 서브에이전트 작업. 주 대화에 섞이지 않고 따로 온다. */
  agentTasks: AgentTask[]
}

export class ChatSession {
  private unsubscribe: Unsubscribe | null = null
  private chatId: string | null = null
  private unsubscribeClose: Unsubscribe | null = null
  // 이력 재생 중 인터럽트 억제 (replayGate.ts)
  private readonly replay = new ReplayGate()

  private readonly messages = new MessageStore()
  private readonly turns = new TurnMetaStore()
  private readonly tasks = new AgentTaskStore()
  private readonly router: ChunkRouter
  private readonly responder: ChatResponder
  // 턴 종료 판정·중단 방어(turnOpen 가드, terminal 해석, 취소 타임아웃)는 TurnGate 몫이다
  private readonly gate: TurnGate
  // 보낸 요청이 침묵으로 끝나지 않게 하는 최후 보장 (replyWatch.ts)
  private readonly reply = new ReplyWatch(() => this.onSilentReply())

  private readonly eventHandlers = new HandlerSet<[TurnEvent]>()
  private readonly snapshotHandlers = new HandlerSet<[ChatSnapshot]>()

  constructor(
    private readonly transport: Transport,
    private readonly options: ChatSessionOptions = {},
  ) {
    this.router = new ChunkRouter({ messages: this.messages, turns: this.turns, tasks: this.tasks })
    this.responder = createResponder(transport, () => this.chatId)
    this.gate = new TurnGate({
      turns: this.turns,
      messages: this.messages,
      emit: (event) => this.emit(event),
      pushSnapshot: () => this.pushSnapshot(),
    })
  }

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.transport.onMessage((raw) => this.handleMessage(raw))
    // 턴 도중 소켓이 끊기면 종료 신호가 영영 오지 않는다. 여기서 닫아준다.
    this.unsubscribeClose = this.transport.onClose(() =>
      this.gate.end({ failed: true, errorCode: 'CONNECTION_LOST' }),
    )
  }

  stop(): void {
    this.reply.disarm()
    this.gate.clearCancelRequest()
    this.endHistoryReplay()
    this.unsubscribe?.()
    this.unsubscribe = null
    this.unsubscribeClose?.()
    this.unsubscribeClose = null
    this.eventHandlers.clear()
    this.snapshotHandlers.clear()
  }

  /** 지금 응답을 기다리는 중인가. 화면이 진행 표시를 결정하는 데 쓴다. */
  get isTurnOpen(): boolean {
    return this.gate.isOpen
  }

  onEvent(handler: (event: TurnEvent) => void): Unsubscribe {
    return this.eventHandlers.add(handler)
  }

  /** 메시지 배열이 바뀔 때마다 스냅샷을 밀어준다 — renderer 가 이걸 렌더한다 */
  onSnapshot(handler: (snapshot: ChatSnapshot) => void): Unsubscribe {
    return this.snapshotHandlers.add(handler)
  }

  snapshot(): ChatSnapshot {
    return {
      messages: this.messages.snapshot(),
      turnMetas: this.turns.snapshot(),
      agentTasks: this.tasks.all,
    }
  }

  /**
   * 질문을 보낸다. 이미지는 runtime 계약대로 data.images 에 실린다
   * (base64 + mediaType, 최대 5장 — shared/protocol/chatImage.ts).
   *
   * 요청별 컨텍스트(이미지·파일·모델·편집기 상태)는 **객체 하나로** 받는다 —
   * positional 인자로 늘리면 호출부에서 자리를 세게 되고, IPC 페이로드와 형태가 갈린다.
   * 경로는 이미 절대경로로 정규화된 상태로 들어온다 (ProjectSession.send → editorContext.ts).
   */
  send(query: string, context: ChatSendContext = {}): boolean {
    // 첨부는 **요약만** 남긴다 — 내용을 담으면 스냅샷마다 수 MB 가 오간다
    this.messages.addUserMessage(query, context.attachments ?? [])
    // 확장이 보낸 것이면 다음에 열리는 턴이 그 요청의 턴이다 (`turnBinder.ts`).
    //
    // **보내기 전에 등록한다.** 어댑터의 `send()` 는 프레임을 받자마자 같은 호출 안에서
    // `STREAM_START` 를 emit 한다 (`opencode/transport.ts` — dispatch 가 async 지만 첫
    // await 전에 emit 이 끝난다). 뒤에 등록하면 턴이 이미 열린 뒤라 **아무것도 안 묶이고**,
    // 답이 와도 확장의 promise 가 영영 안 풀린다 (2026-08-14 실물에서 겪었다).
    const asked = context.extensionRequestId
    if (asked) this.options.binder?.markPending(asked)

    const sent = this.transport.send(chatRequestFrame(query, context, { chatId: this.chatId }))
    // 못 보냈으면 방금 등록한 것을 되돌린다. 이미 묶인 턴은 건드리지 않는다.
    if (asked && !sent) this.options.binder?.rejectPending('연결이 끊겨 보내지 못했습니다')
    // 사용자 말풍선은 이미 올라갔다. 여기서 실패를 삼키면 화면은 "보냈다" 고 말하면서
    // 영원히 답이 오지 않는다 — 답이 없는 채로 끝나는 경우는 없어야 한다.
    if (sent) this.reply.arm()
    else this.messages.addError({ message: '연결이 끊겨 메시지를 보내지 못했습니다. 연결이 복구되면 다시 보내주세요.' })
    this.pushSnapshot()
    return sent
  }

  /** 보내긴 했는데 runtime 이 아무 응답도 주지 않았다 — 원인은 몰라도 사용자에게는 알린다 */
  private onSilentReply(): void {
    if (this.gate.isOpen) return // 턴은 열렸다 — 침묵이 아니다
    this.messages.addError({
      message: '메시지를 보냈지만 런타임이 응답하지 않았습니다. 연결 상태를 확인하고 다시 보내주세요.',
    })
    this.pushSnapshot()
  }

  /** 진행 중인 스트림을 취소한다. runtime 이 취소 안내 + stream_end 를 보내 턴은 정상 닫힌다. */
  cancel(): boolean {
    if (!this.gate.isOpen) return false
    // 확장이 기다리는 턴이면 취소로 돌려준다 — 뒤이어 올 stream_end 보다 뜻이 정확하다
    if (this.gate.streamId) this.options.binder?.onCancelled(this.gate.streamId)
    this.gate.requestCancel()
    return this.transport.send(
      cancelFrame({ chatId: this.chatId, streamId: this.gate.streamId }),
    )
  }

  /**
   * 새 대화를 시작한다. 화면과 턴 상태를 비우되 연결은 유지한다.
   *
   * **진행 중인 스트림을 먼저 취소한다** (vscode createNewChat 과 동일).
   * 안 그러면 runtime 은 계속 스트리밍하는데 화면은 비어 있어,
   * 새 대화에 옛 응답 조각이 섞여 들어온다.
   */
  /** 발급받은 chat_id 를 심는다 (chat_history_add). 이후 요청이 이 id 로 나간다. */
  setChatId(chatId: string): void { this.chatId = chatId }

  reset(): void {
    this.cancel()
    // 취소 프레임만 보내고 턴은 여기서 즉시 닫는다 — end 경로를 타야 turn_ended 가
    // renderer 까지 흘러 승인·질문·계획·스트리밍 상태가 정리된다. 안 그러면 스테일
    // 카드가 새 대화에 남는다. end 가 첫 줄에서 clearCancelRequest 를 수행하므로
    // 방금 건 취소 타임아웃 방어도 함께 풀리고, turnOpen 가드로 중복 실행도 없다.
    this.gate.end({ failed: false })
    this.messages.reset()
    this.turns.reset()
    this.tasks.reset()
    this.chatId = null
    this.gate.reset()
    this.pushSnapshot()
  }

  /** 이력 재생 시작 — load_complete(또는 폴백 타임아웃)까지 인터럽트 3종을 올리지 않는다 */
  beginHistoryReplay(): void {
    this.replay.begin()
  }

  /** 이력 재생 종료 — 이후 도착하는 인터럽트는 라이브다 */
  endHistoryReplay(): void {
    this.replay.end()
  }

  /** 로컬 기록(셸 결과·이스터에그 안내)을 대화에 남긴다 — runtime 을 거치지 않으므로 턴은 열리지 않는다 */
  addLocal(record: (messages: MessageStore) => void): void {
    record(this.messages)
    this.pushSnapshot()
  }

  // 카드 답신 셋은 `chatResponses.ts` 가 진다 (세션 상태를 안 건드린다). 여기는 통로일 뿐이라
  // `setChatId` 처럼 한 줄로 둔다.
  respondApproval(id: string, ok: boolean, more?: ApprovalFollowUp) { return this.responder.approval(id, ok, more) }
  respondQuestion(id: string, answer: string | null) { return this.responder.question(id, answer) }
  respondPlan(id: string, ok: boolean, comment?: string) { return this.responder.plan(id, ok, comment) }

  // 프레임을 누구에게 넘길지는 `frameDispatch` 가 정한다 (해석은 여전히 ChunkRouter 몫이다).
  private handleMessage(raw: string): void {
    dispatchChatFrame(raw, {
      // 서버가 chatId 를 발급하면 이후 요청에 실어 보낸다 (chat_service.py:1429-1430)
      onChatId: (chatId) => (this.chatId = chatId),
      onUserQuery: (query) => {
        this.messages.addUserMessage(query)
        this.pushSnapshot()
      },
      onStreamStart: (streamId) => {
        this.options.binder?.onStreamStart(streamId)
        this.gate.onStreamStart(streamId)
      },
      onChunk: (data, streamId) => this.handleChunk(data, streamId),
      onStreamEnd: (data, streamId) => {
        // 게이트보다 **먼저** 넘긴다 — 게이트가 턴을 닫으며 메시지를 손대기 전의 답이 필요하다
        if (streamId) this.options.binder?.onStreamEnd(streamId, this.lastAssistantText())
        this.gate.onStreamEnd(data)
      },
      onError: (data) => this.handleErrorFrame(data),
    })
  }

  private handleChunk(data: unknown, streamId?: string): void {
    if (data === null || typeof data !== 'object') return

    const result = this.router.route(data as Record<string, unknown>, streamId)

    // 인터럽트 → 이벤트. autoApprove 는 도구 승인만 자동 응답한다 — 질문·계획은 항상 묻는다.
    // 이력 재생 중엔 셋 다 올리지 않는다(자동 응답 포함) — 죽은 인터럽트라 응답할 곳이 없다.
    if (!this.replay.isReplaying) {
      const auto = this.options.autoApprove === true
      if (result.approval && auto) this.respondApproval(result.approval.requestId, true)
      for (const event of interruptTurnEvents(result, this.gate.turnId(), auto)) this.emit(event)
    }

    if (result.effect) this.emitEffect(result.effect)
    if (result.changed) this.pushSnapshot()
  }

  /** 라우터가 해석한 결과를 이벤트로 옮긴다. 여기서 청크를 다시 읽지 않는다. */
  private emitEffect(effect: RouteEffect): void {
    emitRouteEffect(effect, {
      onTurnStarted: (turnId) => {
        this.reply.disarm()
        this.gate.onTurnStarted(turnId)
      },
      turnId: () => this.gate.turnId(),
      emit: (event) => this.emit(event),
    })
  }

  private handleErrorFrame(data: unknown): void {
    const payload = (data ?? {}) as Record<string, unknown>
    const code = typeof payload['code'] === 'string' ? { code: payload['code'] as string } : {}
    const message = String(payload['message'] ?? '알 수 없는 오류')

    // 에러도 응답이다 — 침묵 감시를 푼다 (이게 없으면 에러 뒤에 침묵 안내가 겹쳐 뜬다)
    this.reply.disarm()
    // 대화에 에러를 남긴다 — 이벤트만 내면 화면이 안 바뀌어 무반응이 된다 (청크 에러와 같게)
    this.messages.addError({ message, ...code })
    this.emit({ type: 'error', message, ...code })
    // 에러로 끝난 턴은 stream_end 가 안 올 수 있다 — 여기서도 닫는다
    this.gate.end({ failed: true, ...('code' in code ? { errorCode: code.code } : {}) })
  }

  private emit(event: TurnEvent): void {
    this.eventHandlers.emit(event)
  }

  /** 이번 턴의 답. 확장에 돌려줄 것이라 **마지막 assistant 메시지 하나**만 본다. */
  private lastAssistantText(): string {
    const messages = this.messages.snapshot()
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.author === 'assistant' && message.content) return message.content
    }
    return ''
  }

  private pushSnapshot(): void {
    this.snapshotHandlers.emit(this.snapshot())
  }
}
