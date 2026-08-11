import { createEnvelope, parseInbound, serializeEnvelope } from '../../shared/protocol/envelope'
import { Action, Kind } from '../../shared/protocol/kinds'
import { parseTurnReview } from '../../shared/protocol/parseTurnReview'
import { isFinalState, type TurnReview } from '../../shared/protocol/turnReview'
import { HandlerSet, type Transport, type Unsubscribe } from '../ws/transport'

// 턴 리뷰 (V2). 런타임이 이미 디스크에 썼고, 우리는 결과를 보여주고 판정만 전달한다.
//
// turn_changes 는 replyTo 가 없는 푸시다. 응답하지 않아도 교착되지 않는다 —
// 턴이 PENDING_DECISION 으로 남고 다음 chat_request 가 확정한다.

export type ReviewDecision = 'accept' | 'reject'

export class TurnReviewController {
  /** turnId → 리뷰. **위치가 아니라 id 로 관리한다** — 위치로 지우면 엉뚱한 카드가 사라진다. */
  private reviews = new Map<string, TurnReview>()
  private unsubscribe: Unsubscribe | null = null

  private readonly changeHandlers = new HandlerSet<[TurnReview[]]>()

  constructor(private readonly transport: Transport) {}

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.transport.onMessage((raw) => this.handleMessage(raw))
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.changeHandlers.clear()
  }

  get all(): TurnReview[] {
    return [...this.reviews.values()]
  }

  onChange(handler: (reviews: TurnReview[]) => void): Unsubscribe {
    return this.changeHandlers.add(handler)
  }

  /**
   * 판정을 보낸다.
   * filePaths 를 주면 그 파일만 되돌린다 (부분 거부).
   */
  decide(turnId: string, decision: ReviewDecision, filePaths?: string[]): boolean {
    const review = this.reviews.get(turnId)
    if (!review) return false
    // 최종 상태는 더 손댈 수 없다
    if (isFinalState(review)) return false

    const action = decision === 'accept' ? Action.TURN_ACK : Action.TURN_REJECT
    const data: Record<string, unknown> = { turnId }
    if (filePaths?.length) data['filePaths'] = filePaths

    return this.transport.send(serializeEnvelope(createEnvelope(Kind.DIFF, action, data)))
  }

  /** 새 대화를 시작하면 카드도 비운다 */
  reset(): void {
    if (this.reviews.size === 0) return
    this.reviews.clear()
    this.emit()
  }

  private handleMessage(raw: string): void {
    const frame = parseInbound(raw)
    if (!frame || frame.kind !== Kind.DIFF) return

    if (frame.action === Action.TURN_CHANGES || frame.action === Action.TURN_STATUS) {
      const review = parseTurnReview(frame.data)
      if (!review) return
      this.reviews.set(review.turnId, review)
      this.emit()
      return
    }

    if (frame.action === Action.CHAT_REWOUND) {
      this.reset()
    }
  }

  private emit(): void {
    this.changeHandlers.emit(this.all)
  }
}
