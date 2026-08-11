// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToasts } from './useToasts'

// 잠깐 떴다 사라지는 알림. 종류(info/error)별 수명과 id 격리를 지킨다.

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('토스트', () => {
  it('처음엔 비어 있다', () => {
    const { result } = renderHook(() => useToasts())
    expect(result.current.toasts).toEqual([])
  })

  it('띄우면 목록에 쌓이고 tone 은 기본이 info 다', () => {
    const { result } = renderHook(() => useToasts())
    act(() => result.current.show('저장됨'))
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0]).toMatchObject({ text: '저장됨', tone: 'info' })
  })

  it('tone 을 넘기면 그대로 쓴다', () => {
    const { result } = renderHook(() => useToasts())
    act(() => result.current.show('실패', 'error'))
    expect(result.current.toasts[0]!.tone).toBe('error')
  })

  it('띄울 때마다 id 가 올라간다 — 같은 문구여도 서로 다른 알림이다', () => {
    const { result } = renderHook(() => useToasts())
    act(() => result.current.show('같음'))
    act(() => result.current.show('같음'))
    const [a, b] = result.current.toasts
    expect(a!.id).not.toBe(b!.id)
    expect(b!.id).toBeGreaterThan(a!.id)
  })

  it('info 는 3초 뒤 저절로 사라진다', () => {
    const { result } = renderHook(() => useToasts())
    act(() => result.current.show('안녕'))
    act(() => vi.advanceTimersByTime(2999))
    expect(result.current.toasts).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.toasts).toHaveLength(0)
  })

  it('error 는 두 배(6초) 더 오래 둔다', () => {
    const { result } = renderHook(() => useToasts())
    act(() => result.current.show('오류', 'error'))
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.toasts).toHaveLength(1) // info 였다면 사라졌을 시점
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.toasts).toHaveLength(0)
  })

  it('dismiss 로 특정 알림만 지운다', () => {
    const { result } = renderHook(() => useToasts())
    act(() => result.current.show('하나'))
    act(() => result.current.show('둘'))
    const target = result.current.toasts[0]!.id
    act(() => result.current.dismiss(target))
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0]!.text).toBe('둘')
  })

  it('없는 id 를 dismiss 해도 아무 일 없다', () => {
    const { result } = renderHook(() => useToasts())
    act(() => result.current.show('그대로'))
    act(() => result.current.dismiss(9999))
    expect(result.current.toasts).toHaveLength(1)
  })

  it('여러 개가 각자의 시간표대로 사라진다', () => {
    const { result } = renderHook(() => useToasts())
    act(() => result.current.show('info'))
    act(() => result.current.show('error', 'error'))
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.toasts.map((t) => t.text)).toEqual(['error'])
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.toasts).toHaveLength(0)
  })
})
