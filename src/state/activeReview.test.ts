import { describe, expect, it } from 'vitest'
import { TurnReviewStatus, type TurnReview } from '../../shared/protocol/turnReview'
import { activeReviewOf } from './activeReview'

// 단축키가 겨눌 카드 하나를 고른다. 카드의 버튼 표시 규칙과 같은 판정을 써야
// "버튼은 없는데 키는 먹는" 상태가 안 생긴다.

function review(turnId: string, patch: Partial<TurnReview> = {}): TurnReview {
  return {
    turnId,
    status: TurnReviewStatus.PENDING_DECISION,
    files: [],
    ...patch,
  }
}

describe('활성 턴 리뷰', () => {
  it('없으면 null', () => {
    expect(activeReviewOf([])).toBeNull()
  })

  it('마지막 리뷰만 겨눈다 — 옛 카드는 보기만 한다', () => {
    const target = activeReviewOf([review('t1'), review('t2')])
    expect(target?.review.turnId).toBe('t2')
  })

  it('최종 상태면 겨누지 않는다 — 손댈 수 없는 카드다', () => {
    expect(activeReviewOf([review('t1', { status: TurnReviewStatus.FAILED })])).toBeNull()
    expect(activeReviewOf([review('t1', { isFinalized: true })])).toBeNull()
  })

  it('잠정 상태(확정 전 ACCEPTED)는 아직 겨눈다 — 사용자가 뒤집을 수 있다', () => {
    const target = activeReviewOf([review('t1', { status: TurnReviewStatus.ACCEPTED })])
    expect(target?.review.turnId).toBe('t1')
  })

  it('보낼 수 있는 판정은 런타임의 actions 가 정한다', () => {
    expect(activeReviewOf([review('t1', { actions: ['reject'] })])?.actions).toEqual(['reject'])
    // 런타임이 허용해도 보낼 곳이 없는 액션은 빠진다 (DC-1214)
    expect(activeReviewOf([review('t1', { actions: ['accept_current'] })])?.actions).toEqual([])
  })

  it('actions 를 안 주는 구버전 런타임에서는 둘 다 (종전 동작)', () => {
    expect(activeReviewOf([review('t1')])?.actions).toEqual(['accept', 'reject'])
  })
})
