import { useEffect, useState } from 'react'
import type { GesturePoint } from '../state/mouseGesture'
import type { MouseGestureApi } from '../state/useMouseGesture'

// ㄴ 제스처의 궤적 잔상 — 그리는 동안 지나간 경로를 선으로 보여준다.
//
// useMouseGesture 의 궤적 스트림을 구독해 **이 오버레이만** 리렌더된다 (파일/로그 뷰 무관).
// 떼면(스트림 null) 짧게 페이드아웃하고 사라진다 — 인식 성공/실패와 무관하게 그린 건 보여준다.
// position:fixed + pointer-events:none — clientX/Y 좌표 그대로 쓰고, 히트테스트를 막지 않는다.

/** 페이드아웃 시간(ms). CSS transition 과 제거 타이머가 같은 값을 쓴다. */
export const TRAIL_FADE_MS = 300

export function GestureTrail({ gesture }: { gesture: MouseGestureApi }) {
  const [trail, setTrail] = useState<readonly GesturePoint[] | null>(null)
  const [fading, setFading] = useState(false)

  useEffect(
    () =>
      gesture.subscribeTrail((points) => {
        if (points !== null) {
          setFading(false)
          setTrail(points)
        } else {
          setFading(true) // 그리기 끝 — 페이드 시작, 제거는 아래 타이머가
        }
      }),
    [gesture],
  )

  useEffect(() => {
    if (!fading) return
    const timer = setTimeout(() => {
      setTrail(null)
      setFading(false)
    }, TRAIL_FADE_MS)
    return () => clearTimeout(timer)
  }, [fading])

  if (trail === null) return null

  return (
    <svg
      data-testid="gesture-trail"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000,
        opacity: fading ? 0 : 1,
        transition: `opacity ${TRAIL_FADE_MS}ms ease-out`,
      }}
    >
      <polyline
        points={trail.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="none"
        stroke="var(--dc-accent)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
