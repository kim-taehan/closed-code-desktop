import { useCallback, useMemo, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { recognizeGesture, type GestureKind, type GesturePoint } from './mouseGesture'

// 우클릭 드래그 제스처(ㄴ = 탭 닫기, ←·→ = 탭 순환)를 추적해 종류와 함께 콜백한다.
//
// 좌클릭 드래그는 텍스트 선택과 충돌해 **우클릭**으로 그린다. 제스처가 인식되면
// 그 자리의 contextmenu 를 1회 억제하고, 인식 안 되면(그냥 우클릭) 기본 동작 그대로다.
// (macOS 는 contextmenu 가 pointerdown 시점에 먼저 올 수 있으나, 앱이 자체 컨텍스트
// 메뉴를 달지 않아 실해는 없다.)
// 영역을 벗어나면 취소 — 창 밖으로 나간 드래그가 유령 제스처로 남지 않게.
//
// 궤적은 상태가 아니라 **구독 스트림**으로 낸다 — 상태로 들면 pointermove 마다
// 래퍼 아래 전체(파일 뷰 등)가 리렌더된다. 오버레이(GestureTrail)만 갱신되면 된다.

/** 이만큼 움직이기 전에는 궤적을 그리지 않는다 — 그냥 우클릭에 잔상이 뜨면 지저분하다 */
export const TRAIL_MIN_DRAG_PX = 8

/** 궤적 스트림. 점 배열 = 그리는 중, null = 끝(오버레이가 페이드아웃 시작). */
export type TrailListener = (points: readonly GesturePoint[] | null) => void

export interface MouseGestureHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerLeave: () => void
  onPointerCancel: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
}

export interface MouseGestureApi {
  /** 대상 컨테이너에 그대로 스프레드한다 */
  handlers: MouseGestureHandlers
  /** 궤적 오버레이(GestureTrail)가 구독한다. 해지 함수를 돌려준다. */
  subscribeTrail: (listener: TrailListener) => () => void
}

export function useMouseGesture(onGesture: (kind: GestureKind) => void): MouseGestureApi {
  // 그리는 중인 점들. null 이면 추적 중이 아니다. 렌더와 무관한 상태라 ref 로 든다.
  const points = useRef<GesturePoint[] | null>(null)
  const suppressMenu = useRef(false)
  // 이동 임계를 넘어 궤적을 내보내는 중인가
  const trailing = useRef(false)
  const listeners = useRef(new Set<TrailListener>())

  const emitTrail = useCallback((snapshot: readonly GesturePoint[] | null) => {
    for (const listener of listeners.current) listener(snapshot)
  }, [])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button === 2) points.current = [{ x: event.clientX, y: event.clientY }]
  }, [])

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drawn = points.current
      if (drawn === null) return
      drawn.push({ x: event.clientX, y: event.clientY })
      if (!trailing.current) {
        const first = drawn[0]!
        trailing.current =
          Math.hypot(event.clientX - first.x, event.clientY - first.y) > TRAIL_MIN_DRAG_PX
      }
      if (trailing.current) emitTrail([...drawn])
    },
    [emitTrail],
  )

  // 어느 경로로 끝나든 궤적 스트림을 닫는다 — 오버레이는 null 을 받아야 페이드를 시작한다
  const endTrail = useCallback(() => {
    if (trailing.current) emitTrail(null)
    trailing.current = false
    points.current = null
  }, [emitTrail])

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 2 || points.current === null) return
      const drawn = points.current
      endTrail()
      const kind = recognizeGesture(drawn)
      if (kind !== null) {
        suppressMenu.current = true
        onGesture(kind)
      }
    },
    [endTrail, onGesture],
  )

  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (suppressMenu.current) {
      suppressMenu.current = false
      event.preventDefault()
    }
  }, [])

  const subscribeTrail = useCallback((listener: TrailListener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const handlers = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerLeave: endTrail,
      onPointerCancel: endTrail,
      onContextMenu,
    }),
    [onPointerDown, onPointerMove, onPointerUp, endTrail, onContextMenu],
  )

  return useMemo(() => ({ handlers, subscribeTrail }), [handlers, subscribeTrail])
}
