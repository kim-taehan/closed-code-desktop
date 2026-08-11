import { describe, expect, it } from 'vitest'
import { isGestureL, recognizeGesture, type GesturePoint } from './mouseGesture'

// 제스처 판정 규칙을 잠근다 — 여기가 풀리면 탭이 엉뚱한 우클릭에 닫히거나 넘어간다.

/** from→to 를 잇는 직선 위의 점들 (양 끝 포함) */
function line(from: GesturePoint, to: GesturePoint, steps = 10): GesturePoint[] {
  const points: GesturePoint[] = []
  for (let i = 0; i <= steps; i++) {
    points.push({
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    })
  }
  return points
}

describe('정인식', () => {
  it('아래로 긋고 오른쪽으로 꺾으면 ㄴ 이다', () => {
    const points = [...line({ x: 100, y: 100 }, { x: 100, y: 220 }), ...line({ x: 100, y: 220 }, { x: 220, y: 220 })]
    expect(isGestureL(points)).toBe(true)
  })

  it('획이 25도 안에서 기울어도 인정한다 — 손은 자를 못 쓴다', () => {
    // 아래 획이 오른쪽으로 40px 흘렀다 (120px 내려가며 tan25° ≈ 56px 까지 허용)
    const points = [...line({ x: 100, y: 100 }, { x: 140, y: 220 }), ...line({ x: 140, y: 220 }, { x: 260, y: 230 })]
    expect(isGestureL(points)).toBe(true)
  })
})

describe('오인식 방지', () => {
  it('ㄱ(오른쪽 → 아래)은 아니다', () => {
    const points = [...line({ x: 100, y: 100 }, { x: 220, y: 100 }), ...line({ x: 220, y: 100 }, { x: 220, y: 220 })]
    expect(isGestureL(points)).toBe(false)
  })

  it('一(수평 한 획)은 아니다', () => {
    expect(isGestureL(line({ x: 100, y: 100 }, { x: 300, y: 100 }))).toBe(false)
  })

  it('ㅣ(수직 한 획)은 아니다', () => {
    expect(isGestureL(line({ x: 100, y: 100 }, { x: 100, y: 300 }))).toBe(false)
  })

  it('대각선(45°)은 아니다 — 방향 오차 25° 를 넘는다', () => {
    expect(isGestureL(line({ x: 100, y: 100 }, { x: 300, y: 300 }))).toBe(false)
  })

  it('첫 획이 30° 기울면 탈락한다 — 오차 상한(25°) 거부 방향 잠금', () => {
    // 아래 획이 120px 내려가며 오른쪽으로 70px 흐름 (tan30° ≈ 0.58 > tan25° ≈ 0.47).
    // 옛 상한(30°)이면 통과했을 값이라 25° 축소를 정확히 잠근다.
    const points = [...line({ x: 100, y: 100 }, { x: 170, y: 220 }), ...line({ x: 170, y: 220 }, { x: 290, y: 220 })]
    expect(isGestureL(points)).toBe(false)
  })

  it('획이 짧으면(90px 미만) 아니다 — 60→90 상향 잠금', () => {
    // 80px 은 옛 상한(60px)이면 통과했을 길이다
    const points = [...line({ x: 100, y: 100 }, { x: 100, y: 180 }), ...line({ x: 100, y: 180 }, { x: 240, y: 180 })]
    expect(isGestureL(points)).toBe(false)
  })

  it('지그재그는 방향이 맞아도 이탈 한계에 걸린다', () => {
    // 전체 방향은 아래+오른쪽이지만 아래 획이 좌우로 40px 씩 흔들린다
    const points: GesturePoint[] = [
      { x: 100, y: 100 },
      { x: 140, y: 130 },
      { x: 60, y: 160 },
      { x: 140, y: 190 },
      { x: 100, y: 220 },
      ...line({ x: 100, y: 220 }, { x: 220, y: 220 }),
    ]
    expect(isGestureL(points)).toBe(false)
  })

  it('점이 3개 미만이면 아니다 — 클릭은 제스처가 아니다', () => {
    expect(isGestureL([])).toBe(false)
    expect(isGestureL([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(false)
  })
})

describe('recognizeGesture — 수평 스와이프와 상호 오인식 방지', () => {
  it('순수 수평 우측은 swipe-right, 좌측은 swipe-left', () => {
    expect(recognizeGesture(line({ x: 100, y: 100 }, { x: 250, y: 100 }))).toBe('swipe-right')
    expect(recognizeGesture(line({ x: 250, y: 100 }, { x: 100, y: 110 }))).toBe('swipe-left')
  })

  it('ㄴ 은 L 로만 판정된다 — 둘째 획이 → 여도 스와이프로 새지 않는다', () => {
    const points = [...line({ x: 100, y: 100 }, { x: 100, y: 220 }), ...line({ x: 100, y: 220 }, { x: 220, y: 220 })]
    expect(recognizeGesture(points)).toBe('L')
  })

  it('순수 → 는 ㄴ 이 아니다', () => {
    expect(isGestureL(line({ x: 100, y: 100 }, { x: 250, y: 100 }))).toBe(false)
  })

  it('역 ㄴ(아래로 긋고 왼쪽)은 어느 쪽도 아니다', () => {
    const points = [...line({ x: 200, y: 100 }, { x: 200, y: 220 }), ...line({ x: 200, y: 220 }, { x: 80, y: 220 })]
    expect(recognizeGesture(points)).toBeNull()
  })

  it('중간에 꺾인 수평(→ 다음 ←)은 스와이프가 아니다 — 순수 한 획만 인정', () => {
    const points = [...line({ x: 100, y: 100 }, { x: 250, y: 100 }), ...line({ x: 250, y: 100 }, { x: 180, y: 160 })]
    expect(recognizeGesture(points)).toBeNull()
  })

  it('짧은 수평(120px 미만)·대각선은 스와이프가 아니다', () => {
    // 스와이프 최소 길이는 ㄴ 획(90px)보다 긴 120px — 100px 은 옛 기준(60px)이면 통과했을 길이
    expect(recognizeGesture(line({ x: 100, y: 100 }, { x: 200, y: 100 }))).toBeNull()
    expect(recognizeGesture(line({ x: 100, y: 100 }, { x: 300, y: 300 }))).toBeNull()
  })
})
