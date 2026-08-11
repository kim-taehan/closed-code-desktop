import {
  isFinalState,
  routableActions,
  type RoutableAction,
  type TurnReview,
} from '../../shared/protocol/turnReview'

// 단축키가 겨누는 "지금 조작 가능한 턴 리뷰".
//
// 카드가 조작 가능한 조건은 화면 쪽에 이미 있다 — **마지막 리뷰만**(MessageList 의
// actionsDisabled) 이고 **최종 상태가 아니어야** 한다(TurnReviewPanel 의 live).
// 단축키가 그 규칙을 따로 쓰면 둘이 어긋나 "버튼은 없는데 키는 먹는" 상태가 된다.
// 여기 한 곳에 두고 카드와 단축키가 같이 쓴다.

export interface ReviewShortcutTarget {
  review: TurnReview
  /** 이 리뷰에서 실제로 보낼 수 있는 판정. 런타임의 actions 가 정본이다 (DC-1214). */
  actions: RoutableAction[]
}

export function activeReviewOf(reviews: readonly TurnReview[]): ReviewShortcutTarget | null {
  const review = reviews[reviews.length - 1]
  if (review === undefined || isFinalState(review)) return null
  return { review, actions: routableActions(review) }
}

/** 판정을 런타임으로 보낸다. 카드 버튼과 단축키가 같은 경로를 쓴다. */
export function sendReviewDecision(
  turnId: string,
  decision: RoutableAction,
  filePaths?: string[],
): void {
  void window.davis.decideReview({
    turnId,
    decision,
    ...(filePaths ? { filePaths } : {}),
  })
}
