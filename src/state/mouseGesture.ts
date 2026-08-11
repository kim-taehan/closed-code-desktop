// 'ㄴ' 마우스 제스처 판정 — 순수 로직 (포인터 추적·DOM 은 useMouseGesture 몫).
//
// 규칙: ① 아래로 긋는 첫 획 ② 꺾여서 오른쪽으로 긋는 둘째 획.
// 꺾임점은 "왼쪽-아래 극단점"(y − x 최대)으로 찾는다 — ㄴ 의 모서리가 정확히 그 점이고,
// ㄱ/一/대각선은 이 극단점이 시작·끝에 붙어 획 하나가 비므로 자연히 떨어진다.

export interface GesturePoint {
  x: number
  y: number
}

/** 각 획의 최소 길이(px). 실수 인식이 잦다는 사용자 피드백으로 60→90 상향 (2026-07-23 민감도 하향). */
export const MIN_STROKE_PX = 90
/** 획 방향 허용 오차(도). 같은 민감도 하향으로 30→25 축소. */
export const ANGLE_TOLERANCE_DEG = 25
/** 획이 직선에서 벗어날 수 있는 최대 거리(px) — 지그재그·곡선 낙서를 거른다. */
export const MAX_DEVIATION_PX = 24
/** 수평 스와이프 최소 길이(px). 직선은 짧으면 특히 오인식되기 쉬워 ㄴ 획(90px)보다 길게 잡는다. */
export const SWIPE_MIN_PX = 120

const SLOPE = Math.tan((ANGLE_TOLERANCE_DEG * Math.PI) / 180)

export type GestureKind = 'L' | 'swipe-right' | 'swipe-left'

/**
 * 그린 점 시퀀스를 제스처로 판정한다. **ㄴ 을 먼저 본다** — ㄴ 의 둘째 획도 → 방향이라
 * 순서를 바꾸면 ㄴ 이 스와이프로 새는 계약 위반이 된다. 스와이프는 꺾임 없는
 * 순수 수평(획 하나가 곧게)일 때만 성립하므로 실제 겹침은 없지만, 순서가 계약이다.
 */
export function recognizeGesture(points: readonly GesturePoint[]): GestureKind | null {
  if (isGestureL(points)) return 'L'
  if (isSwipe(points, 1)) return 'swipe-right'
  if (isSwipe(points, -1)) return 'swipe-left'
  return null
}

/** 꺾임 없는 순수 수평 한 획인가. direction 1 = →, -1 = ← */
function isSwipe(points: readonly GesturePoint[], direction: 1 | -1): boolean {
  if (points.length < 3) return false
  const start = points[0]!
  const end = points[points.length - 1]!

  const dx = (end.x - start.x) * direction
  if (dx < SWIPE_MIN_PX) return false
  // 수직 성분이 미미해야 한다 — ㄴ 의 대각 합성(아래+오른쪽)이 여기서 떨어진다
  if (Math.abs(end.y - start.y) > dx * SLOPE) return false
  // 중간에 꺾이면(ㄴ 모서리처럼 이탈이 크면) 스와이프가 아니다
  return maxDeviation(points, 0, points.length - 1) <= MAX_DEVIATION_PX
}

/** 그린 점 시퀀스가 'ㄴ' 인가. 화면 좌표 기준(y 는 아래로 증가). */
export function isGestureL(points: readonly GesturePoint[]): boolean {
  if (points.length < 3) return false
  const start = points[0]!
  const end = points[points.length - 1]!

  // ㄴ 의 모서리 = y − x 가 가장 큰 점
  let cornerIndex = 0
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.y - points[i]!.x > points[cornerIndex]!.y - points[cornerIndex]!.x) {
      cornerIndex = i
    }
  }
  const corner = points[cornerIndex]!

  // ① 아래 획: 수직 성분 우세 + 최소 길이
  const downDx = corner.x - start.x
  const downDy = corner.y - start.y
  if (downDy < MIN_STROKE_PX) return false
  if (Math.abs(downDx) > downDy * SLOPE) return false

  // ② 오른쪽 획: 수평 성분 우세 + 최소 길이
  const rightDx = end.x - corner.x
  const rightDy = end.y - corner.y
  if (rightDx < MIN_STROKE_PX) return false
  if (Math.abs(rightDy) > rightDx * SLOPE) return false

  // ③ 각 획이 곧아야 한다 — 방향만 보면 지그재그도 통과하므로 이탈 한계를 함께 건다
  return (
    maxDeviation(points, 0, cornerIndex) <= MAX_DEVIATION_PX &&
    maxDeviation(points, cornerIndex, points.length - 1) <= MAX_DEVIATION_PX
  )
}

/** 구간 [from..to] 의 점들이 양 끝을 잇는 선분에서 벗어난 최대 수직 거리 */
function maxDeviation(points: readonly GesturePoint[], from: number, to: number): number {
  const a = points[from]!
  const b = points[to]!
  const abx = b.x - a.x
  const aby = b.y - a.y
  const length = Math.hypot(abx, aby)
  if (length === 0) return 0

  let max = 0
  for (let i = from + 1; i < to; i++) {
    const p = points[i]!
    const distance = Math.abs(abx * (p.y - a.y) - aby * (p.x - a.x)) / length
    if (distance > max) max = distance
  }
  return max
}
