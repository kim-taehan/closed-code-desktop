// 턴 리뷰 계약 (ADR-038 §5 구조화 리뷰 + ADR-0002 V2).
//
// **런타임이 이미 diff 를 계산해 내려준다.** 우리는 파싱하지 않고 범위를 그대로 소비한다.
// deprecated 된 diffText 는 쓰지 않는다.

export const TurnReviewStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  PENDING_DECISION: 'PENDING_DECISION',
  PENDING_USER_ACK: 'PENDING_USER_ACK',
  ACCEPTING: 'ACCEPTING',
  REJECTING: 'REJECTING',
  ACCEPTED: 'ACCEPTED',
  USER_ACKED: 'USER_ACKED',
  REJECTED: 'REJECTED',
  ACCEPT_CONFLICT: 'ACCEPT_CONFLICT',
  RESTORE_CONFLICT: 'RESTORE_CONFLICT',
  MANUAL_RESOLUTION_PENDING: 'MANUAL_RESOLUTION_PENDING',
  RESOLVED_MANUALLY: 'RESOLVED_MANUALLY',
  FAILED: 'FAILED',
} as const

export type TurnReviewStatus = (typeof TurnReviewStatus)[keyof typeof TurnReviewStatus]

export const STATUS_LABEL: Record<TurnReviewStatus, string> = {
  IN_PROGRESS: '진행 중',
  PENDING_DECISION: '결정 대기',
  PENDING_USER_ACK: '결정 대기',
  ACCEPTING: '적용 중',
  REJECTING: '복원 중',
  ACCEPTED: '적용됨',
  USER_ACKED: '적용됨',
  REJECTED: '거부됨',
  ACCEPT_CONFLICT: '적용 충돌',
  RESTORE_CONFLICT: '복원 충돌',
  MANUAL_RESOLUTION_PENDING: '수동 해결 대기',
  RESOLVED_MANUALLY: '수동 해결됨',
  FAILED: '실패',
}

export type FileOperation = 'create' | 'modify' | 'delete'
export type ChangeBlockKind = 'insert' | 'delete' | 'replace'

/**
 * 1-indexed, 양끝 포함 라인 범위.
 *
 * **빈 범위 컨벤션**: `endLine === startLine - 1` 이면 빈 범위이고,
 * `startLine` 은 "이 라인 앞" 을 뜻하는 삽입 지점이다.
 * insert 의 oldRange, delete 의 newRange 가 이 형태다.
 */
export interface LineRange {
  startLine: number
  endLine: number
}

export function isEmptyRange(range: LineRange): boolean {
  return range.endLine === range.startLine - 1
}

export function rangeLineCount(range: LineRange): number {
  return isEmptyRange(range) ? 0 : range.endLine - range.startLine + 1
}

export interface ChangeBlock {
  kind: ChangeBlockKind
  oldRange: LineRange
  newRange: LineRange
  /** delete/replace 의 삭제된 원본 라인들 (LF join). insert 는 없다. */
  deletedText?: string
}

/** 크기 한도를 넘어 인라인되지 못한 컨텐츠. turn_fetch_content 로 따로 받아야 한다. */
export interface ContentRef {
  ref: string
}

export type MaybeContent = string | ContentRef | null

export function isContentRef(value: MaybeContent): value is ContentRef {
  return value !== null && typeof value === 'object' && typeof value.ref === 'string'
}

export interface BaseVersion {
  hash: string
  encoding: string
  eol: string
}

export interface TurnFileChange {
  path: string
  operation: FileOperation
  additions: number
  deletions: number
  openable: boolean
  conflictReason?: string
  baseVersion?: BaseVersion
  /** 변경 전 전문. create 는 빈 문자열. */
  baseline: MaybeContent
  /** 변경 후 전문. delete 는 null. */
  modified: MaybeContent
  changeBlocks: ChangeBlock[]
}

export type VerificationStatus = 'verified' | 'unverified' | 'not_required'

export interface TurnVerification {
  status: VerificationStatus
  reason?: string
  commands?: string[]
}

export interface TurnReview {
  turnId: string
  /** 채팅 턴과 잇는 키. 카드를 어느 턴에 붙일지 정한다. */
  chatTurnId?: string
  status: TurnReviewStatus
  /**
   * 최종 확정 여부.
   *
   * ⚠️ 이게 없는 ACCEPTED/REJECTED 는 **잠정** 상태다 — 사용자가 뒤집을 수 있다.
   * vscode 는 이걸 생략하는 런타임에서 턴이 영원히 활성으로 남는 버그가 있다.
   */
  isFinalized?: boolean
  files: TurnFileChange[]
  verification?: TurnVerification
  /** 런타임이 제시하는 추가 동작 (accept_current, mark_resolved 등) */
  actions?: string[]
}

/** 데스크탑이 실제로 런타임에 보낼 수 있는 판정. accept→turn_ack, reject→turn_reject. */
export type RoutableAction = 'accept' | 'reject'

/**
 * 런타임이 허용한다고 말하지만 **보낼 곳이 없는** 액션 (DC-1214).
 *
 * 런타임은 충돌 상태에서 이 둘을 `actions` 에 실어 보낸다
 * (diff_engine/rpc/handlers.py:97-99). 그런데 이를 수행하는
 * `apply_accept_current()` / `apply_mark_resolved()` 는 런타임 안에서
 * 호출되는 곳이 없고, 유일한 진입점이던 `turn/decide` 는 ADR-0002 로 폐기돼
 * 항상 deprecated 에러만 돌려준다 (handlers.py:999-1032).
 *
 * 그래서 버튼을 만들지 않는다 — 눌러도 실패하는 버튼은 없느니만 못하다.
 * 런타임에 핸들러가 생기면 이 목록에서 빼고 전송 경로만 이어주면 된다.
 */
const UNROUTABLE_ACTIONS: readonly string[] = ['accept_current', 'mark_resolved']

/**
 * 이 리뷰에서 화면에 낼 판정 버튼.
 *
 * **런타임의 `actions` 가 정본이다.** 상태로 우리가 다시 추론하면
 * 런타임이 닫아둔 결정을 화면이 열어주는 어긋남이 생긴다.
 * `actions` 를 주지 않는 구버전 런타임에서만 종전 동작(accept/reject)으로 폴백한다.
 */
export function routableActions(review: TurnReview): RoutableAction[] {
  if (review.actions === undefined) return ['accept', 'reject']
  return review.actions.filter((action): action is RoutableAction =>
    action === 'accept' || action === 'reject',
  )
}

/**
 * 사람이 편집기에서 직접 정리해야 풀리는 상태인가.
 * 런타임이 허용한 액션이 전부 보낼 수 없는 것들일 때가 그렇다.
 */
export function needsManualResolution(review: TurnReview): boolean {
  return review.actions?.some((action) => UNROUTABLE_ACTIONS.includes(action)) === true
}

/** 사용자가 뒤집을 수 있는 잠정 상태인가 */
export function isProvisional(review: TurnReview): boolean {
  const decided =
    review.status === TurnReviewStatus.ACCEPTED ||
    review.status === TurnReviewStatus.USER_ACKED ||
    review.status === TurnReviewStatus.REJECTED
  return decided && review.isFinalized !== true
}

/** 더 이상 손댈 수 없는 상태인가 */
export function isFinalState(review: TurnReview): boolean {
  if (review.isFinalized === true) return true
  return (
    review.status === TurnReviewStatus.FAILED ||
    review.status === TurnReviewStatus.RESOLVED_MANUALLY
  )
}

export function totalChanges(review: TurnReview): { additions: number; deletions: number } {
  return review.files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  )
}
