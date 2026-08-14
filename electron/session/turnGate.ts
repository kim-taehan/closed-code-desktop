import type { StreamEndData } from '../../shared/protocol/chunkTypes'
import type { TurnEvent } from '../../shared/ipc/channels'
import type { MessageStore } from './messageStore'
import type { TurnMetaStore } from './turnMeta'

// 턴 종료 판정과 중단 방어. ChatSession 에서 응집 분리한 것으로 행동은 그대로다.
//
// 종료 신호가 하나뿐이라 놓치면 전송이 영구 잠긴다(desktop2 postmortem) —
// 종료 경로(stream_end·error·소켓 끊김·취소 타임아웃)를 여럿 두되
// turnOpen 플래그로 정확히 한 번만 닫는다.

/** 중단 요청 후 이 시간 안에 종단 stream_end 가 없으면 이쪽에서 턴을 닫는다 */
const CANCEL_FORCE_CLOSE_MS = 5_000

export interface TurnGateDeps {
  turns: TurnMetaStore
  messages: MessageStore
  emit(event: TurnEvent): void
  pushSnapshot(): void
}

export class TurnGate {
  // 마지막으로 열린 턴. turn_end 가 활성 턴을 놓은 뒤 오는 stream_end 가 어느 턴인지 알아야 해 따로 든다.
  private lastTurnId: string | null = null
  /** 진행 중인 스트림. 취소하려면 봉투에 streamId 를 실어야 한다 (chat_service.py:943-945). */
  private activeStreamId: string | null = null
  // 턴이 열려 있는가. 종료 신호를 놓치면 전송이 영구 잠기므로 이 플래그로 정확히 한 번만 닫는다.
  private turnOpen = false
  // 중단을 요청했는가. runtime 이 취소를 못 받는 구멍이 있다 — 스트림 시작 전이라 streamId 가
  // 없거나, HIL 대기라 취소할 task 가 없거나, 취소된 스트림의 stream_end 가 HIL 흔적 때문에
  // terminal=false 로 오는 경우 (stream_lifecycle.py:112). 서버 응답만 기다리면 스피너가 영영
  // 남으므로, 요청 사실을 기억해 뒀다가 시간 안에 안 닫히면 이쪽에서 닫는다.
  private cancelRequested = false
  private cancelTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: TurnGateDeps) {}

  get isOpen(): boolean {
    return this.turnOpen
  }

  get streamId(): string | null {
    return this.activeStreamId
  }

  /**
   * 이 턴에 이미 중단을 요청해 뒀는가. 같은 턴을 두 번 끊지 않게 하는 근거다
   * (`ChatSession.cancel`). 이 플래그가 잠금이 되지는 않는다 — 푸는 것은 턴 종료이고,
   * 종료는 아래 강제 종단 타이머가 `CANCEL_FORCE_CLOSE_MS` 안에 반드시 만들어 낸다.
   */
  get isCancelRequested(): boolean {
    return this.cancelRequested
  }

  onStreamStart(streamId: string): void {
    this.activeStreamId = streamId
  }

  onTurnStarted(turnId: string): void {
    this.lastTurnId = turnId
    this.turnOpen = true
  }

  turnId(): string {
    // turn_end 가 활성 턴을 놓은 뒤에도 stream_end 는 같은 턴에 속한다
    return this.deps.turns.active ?? this.lastTurnId ?? 'turn-unknown'
  }

  /** 중단은 사용자 의사가 확정이다 — runtime 이 안 닫아줘도 일정 시간 뒤 강제로 닫는다 */
  requestCancel(): void {
    this.cancelRequested = true
    this.cancelTimer ??= setTimeout(() => {
      this.cancelTimer = null
      this.end({ failed: false })
    }, CANCEL_FORCE_CLOSE_MS)
  }

  clearCancelRequest(): void {
    this.cancelRequested = false
    if (this.cancelTimer) {
      clearTimeout(this.cancelTimer)
      this.cancelTimer = null
    }
  }

  onStreamEnd(data: StreamEndData | undefined): void {
    const payload = data ?? {}
    // terminal 이 명시적으로 false 일 때만 일시정지다. 누락은 종단으로 본다 (설계 §4.4).
    // 단, 중단을 요청한 턴은 비종단이라도 닫는다 — 취소된 스트림이 HIL 흔적 때문에
    // terminal=false 로 끝나면 재개할 스트림이 없어 영영 열린 채가 된다.
    if (payload.terminal === false && !this.cancelRequested) return

    // 토큰은 **종단에서만** 기록한다. 비종단에서 기록하면 턴 중간에 토큰 줄이 뜬다.
    if (payload.tokenUsage) this.deps.turns.setTokens(this.turnId(), payload.tokenUsage)

    this.end({
      failed: payload.failed === true,
      ...(payload.errorCode ? { errorCode: payload.errorCode } : {}),
    })
  }

  /** 턴을 닫는다. 종료 경로가 여럿이라 **정확히 한 번만** 실행된다. */
  end(outcome: { failed: boolean; errorCode?: string }): void {
    this.clearCancelRequest()
    if (!this.turnOpen) return
    this.turnOpen = false

    const turnId = this.turnId()
    this.activeStreamId = null
    this.deps.turns.markTerminal(turnId, true)
    // 실패로 끝났는데 보여줄 에러가 없으면 무반응이 된다 — 일반 에러라도 남긴다
    if (outcome.failed && !this.deps.messages.lastIsError()) {
      this.deps.messages.addError({ message: '요청을 처리하지 못했습니다', turnId, ...(outcome.errorCode ? { code: outcome.errorCode } : {}) })
    }
    this.deps.emit({
      type: 'turn_ended',
      turnId,
      failed: outcome.failed,
      ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
    })
    this.deps.pushSnapshot()
  }

  /** 새 대화 준비 — 닫힌 턴의 흔적(마지막 턴·스트림 id)을 지운다 */
  reset(): void {
    this.lastTurnId = null
    this.activeStreamId = null
  }
}
