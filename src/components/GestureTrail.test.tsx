// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, fireEvent, act } from '@testing-library/react'
import { useMouseGesture } from '../state/useMouseGesture'
import { GestureTrail, TRAIL_FADE_MS } from './GestureTrail'

// 제스처 궤적 잔상. 그리는 동안 보이고, 떼면 짧게 페이드 후 사라지는지 —
// 그리고 그냥 우클릭(임계 미만 이동)에는 아예 안 뜨는지 확인한다.

function Harness() {
  const gesture = useMouseGesture(() => {})
  return (
    <div data-testid="target" {...gesture.handlers}>
      <GestureTrail gesture={gesture} />
    </div>
  )
}

function setup() {
  const { getByTestId, queryByTestId } = render(<Harness />)
  return { target: getByTestId('target'), trail: () => queryByTestId('gesture-trail') }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('GestureTrail', () => {
  it('이동 임계(8px)를 넘기 전에는 궤적이 없다 — 그냥 우클릭에 잔상 금지', () => {
    const { target, trail } = setup()
    fireEvent.pointerDown(target, { button: 2, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(target, { clientX: 103, clientY: 103 })
    expect(trail()).toBeNull()
  })

  it('드래그 중에는 지나간 점들이 polyline 으로 쌓인다', () => {
    const { target, trail } = setup()
    fireEvent.pointerDown(target, { button: 2, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(target, { clientX: 100, clientY: 140 })
    fireEvent.pointerMove(target, { clientX: 100, clientY: 180 })

    const points = trail()?.querySelector('polyline')?.getAttribute('points')
    expect(points).toContain('100,140')
    expect(points).toContain('100,180')
  })

  it('떼면 페이드 후 사라진다 — 인식 실패 드래그도 그린 건 보여준다', () => {
    vi.useFakeTimers()
    const { target, trail } = setup()
    // 一 자 드래그 (인식 안 되는 모양)
    fireEvent.pointerDown(target, { button: 2, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(target, { clientX: 200, clientY: 100 })
    fireEvent.pointerUp(target, { button: 2, clientX: 200, clientY: 100 })

    // 아직 있다 — 페이드 중 (opacity 0 으로 전환)
    expect(trail()).not.toBeNull()
    expect(trail()!.style.opacity).toBe('0')

    act(() => {
      vi.advanceTimersByTime(TRAIL_FADE_MS)
    })
    expect(trail()).toBeNull()
  })

  it('영역 이탈로 취소돼도 잔상은 정리된다', () => {
    vi.useFakeTimers()
    const { target, trail } = setup()
    fireEvent.pointerDown(target, { button: 2, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(target, { clientX: 100, clientY: 180 })
    fireEvent.pointerLeave(target)

    act(() => {
      vi.advanceTimersByTime(TRAIL_FADE_MS)
    })
    expect(trail()).toBeNull()
  })
})
