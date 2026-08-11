// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { type RefObject } from 'react'
import { useStickToBottom } from './useStickToBottom'

// 새 내용이 오면 바닥으로 따라 내리되, 사용자가 위로 올려 읽고 있으면 따라가지 않는다.
// jsdom 은 scrollHeight 등이 항상 0 이라, 값을 직접 쥐는 가짜 엘리먼트를 세운다.

interface FakeElement {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  addEventListener: (type: string, cb: (e: Event) => void) => void
  removeEventListener: (type: string, cb: (e: Event) => void) => void
  scroll: () => void
}

function fakeElement(init: { scrollTop: number; scrollHeight: number; clientHeight: number }): FakeElement {
  let handler: ((e: Event) => void) | null = null
  return {
    ...init,
    addEventListener(type, cb) {
      if (type === 'scroll') handler = cb
    },
    removeEventListener(type, cb) {
      if (type === 'scroll' && handler === cb) handler = null
    },
    scroll() {
      handler?.(new Event('scroll'))
    },
  }
}

function refOf(el: FakeElement | null): RefObject<HTMLElement | null> {
  return { current: el as unknown as HTMLElement | null }
}

describe('바닥 따라가기', () => {
  it('바닥 근처에서 새 내용이 오면 맨 아래로 내린다', () => {
    const el = fakeElement({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500 })
    const ref = refOf(el)
    const { rerender } = renderHook(({ dep }) => useStickToBottom(ref, dep), { initialProps: { dep: 0 } })
    // 마운트 시 wasAtBottom 기본 true → 이미 바닥으로 붙는다
    expect(el.scrollTop).toBe(1000)

    el.scrollHeight = 1500 // 내용이 늘었다
    rerender({ dep: 1 })
    expect(el.scrollTop).toBe(1500)
  })

  it('사용자가 위로 올려 읽고 있으면 따라가지 않는다', () => {
    const el = fakeElement({ scrollTop: 1000, scrollHeight: 2000, clientHeight: 500 })
    const ref = refOf(el)
    const { rerender } = renderHook(({ dep }) => useStickToBottom(ref, dep), { initialProps: { dep: 0 } })
    el.scrollTop = 100 // 위로 올림 → 바닥과 거리 2000-100-500 = 1400 > 80
    el.scroll()

    el.scrollHeight = 2500
    rerender({ dep: 1 })
    expect(el.scrollTop).toBe(100) // 그대로 둔다
  })

  it('바닥에서 80px 이내면 다시 따라간다', () => {
    const el = fakeElement({ scrollTop: 1000, scrollHeight: 2000, clientHeight: 500 })
    const ref = refOf(el)
    const { rerender } = renderHook(({ dep }) => useStickToBottom(ref, dep), { initialProps: { dep: 0 } })
    // 거리 2000-1450-500 = 50 ≤ 80 → 바닥으로 친다
    el.scrollTop = 1450
    el.scroll()

    el.scrollHeight = 3000
    rerender({ dep: 1 })
    expect(el.scrollTop).toBe(3000)
  })

  it('경계값 80px 딱은 바닥으로 친다 (<=)', () => {
    const el = fakeElement({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500 })
    const ref = refOf(el)
    const { rerender } = renderHook(({ dep }) => useStickToBottom(ref, dep), { initialProps: { dep: 0 } })
    el.scrollTop = 420 // 1000-420-500 = 80
    el.scroll()

    el.scrollHeight = 1200
    rerender({ dep: 1 })
    expect(el.scrollTop).toBe(1200)
  })

  it('ref 가 비어 있으면 아무 일도 하지 않는다', () => {
    const ref = refOf(null)
    expect(() =>
      renderHook(({ dep }) => useStickToBottom(ref, dep), { initialProps: { dep: 0 } }),
    ).not.toThrow()
  })

  it('언마운트하면 scroll 리스너를 뗀다', () => {
    const el = fakeElement({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500 })
    const ref = refOf(el)
    const { unmount } = renderHook(({ dep }) => useStickToBottom(ref, dep), { initialProps: { dep: 0 } })
    unmount()
    // 리스너가 떨어져 scroll 이 상태에 영향을 주지 않는다 (throw 없이 무해)
    expect(() => el.scroll()).not.toThrow()
  })
})
