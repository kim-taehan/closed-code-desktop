// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSidebarWidth } from './useSidebarWidth'

// 사이드바 폭. 끌어서 바꾸고 localStorage 로 남긴다. 200~560 로 가둔다.

const KEY = 'davis.sidebarWidth'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

/** clientX 를 실은 mousemove 를 document 에 흘린다 */
function move(clientX: number) {
  act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX })))
}
function up() {
  act(() => document.dispatchEvent(new MouseEvent('mouseup')))
}

describe('초기값 로드', () => {
  it('저장된 값이 없으면 기본 320 이다', () => {
    const { result } = renderHook(() => useSidebarWidth())
    expect(result.current.width).toBe(320)
  })

  it('저장된 값을 읽어 온다', () => {
    localStorage.setItem(KEY, '400')
    const { result } = renderHook(() => useSidebarWidth())
    expect(result.current.width).toBe(400)
  })

  it('저장값이 범위를 벗어나면 가둬서 읽는다', () => {
    localStorage.setItem(KEY, '9999')
    const { result } = renderHook(() => useSidebarWidth())
    expect(result.current.width).toBe(560)
  })

  it('숫자가 아니거나 0 이하면 기본값으로 되돌린다', () => {
    localStorage.setItem(KEY, '이상한값')
    expect(renderHook(() => useSidebarWidth()).result.current.width).toBe(320)
    localStorage.setItem(KEY, '-5')
    expect(renderHook(() => useSidebarWidth()).result.current.width).toBe(320)
  })
})

describe('드래그', () => {
  it('startDrag 는 기본동작을 막고 dragging 을 켠다', () => {
    const { result } = renderHook(() => useSidebarWidth())
    const preventDefault = vi.fn()
    act(() => result.current.startDrag({ preventDefault } as unknown as React.MouseEvent))
    expect(preventDefault).toHaveBeenCalled()
    expect(result.current.dragging).toBe(true)
  })

  it('드래그 중 커서 x 가 곧 폭이다', () => {
    const { result } = renderHook(() => useSidebarWidth())
    act(() => result.current.startDrag({ preventDefault() {} } as unknown as React.MouseEvent))
    move(420)
    expect(result.current.width).toBe(420)
  })

  it('폭은 최소·최대로 가둔다', () => {
    const { result } = renderHook(() => useSidebarWidth())
    act(() => result.current.startDrag({ preventDefault() {} } as unknown as React.MouseEvent))
    move(50)
    expect(result.current.width).toBe(200)
    move(9999)
    expect(result.current.width).toBe(560)
  })

  it('놓으면 dragging 이 꺼지고 마지막 폭을 저장한다', () => {
    const { result } = renderHook(() => useSidebarWidth())
    act(() => result.current.startDrag({ preventDefault() {} } as unknown as React.MouseEvent))
    move(360)
    up()
    expect(result.current.dragging).toBe(false)
    expect(localStorage.getItem(KEY)).toBe('360')
  })

  it('놓은 뒤에는 움직여도 폭이 바뀌지 않는다 — 리스너가 떨어졌다', () => {
    const { result } = renderHook(() => useSidebarWidth())
    act(() => result.current.startDrag({ preventDefault() {} } as unknown as React.MouseEvent))
    move(360)
    up()
    move(500)
    expect(result.current.width).toBe(360)
  })

  it('저장한 폭은 다음 실행에도 남는다', () => {
    const first = renderHook(() => useSidebarWidth())
    act(() => first.result.current.startDrag({ preventDefault() {} } as unknown as React.MouseEvent))
    move(300)
    up()
    const second = renderHook(() => useSidebarWidth())
    expect(second.result.current.width).toBe(300)
  })
})
