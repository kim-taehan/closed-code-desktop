// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { THEMES, useTheme } from './useTheme'

// 테마 선택. 고른 대로만 보이고, 다음 실행에도 남아야 한다.

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  localStorage.clear()
})

describe('기본값', () => {
  it('저장된 값이 없으면 다크로 시작한다', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.choice).toBe('dark')
  })

  it('시작하자마자 data-theme 을 붙인다 — 없으면 어떤 팔레트인지 알 수 없다', () => {
    renderHook(() => useTheme())
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('고르기', () => {
  it.each(THEMES)('%s 를 고르면 그 팔레트가 붙는다', (theme) => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setChoice(theme))

    expect(result.current.choice).toBe(theme)
    expect(document.documentElement.getAttribute('data-theme')).toBe(theme)
  })

  it('고른 값이 저장돼 다음 실행에도 남는다', () => {
    const first = renderHook(() => useTheme())
    act(() => first.result.current.setChoice('ivory'))

    const second = renderHook(() => useTheme())
    expect(second.result.current.choice).toBe('ivory')
  })
})

describe('없어진 값 이관', () => {
  // 라이트/다크 두 가지뿐이던 시절의 저장값
  it('light 는 페이퍼 화이트로 옮긴다', () => {
    localStorage.setItem('davis.theme', 'light')

    const { result } = renderHook(() => useTheme())
    expect(result.current.choice).toBe('paper')
  })

  it('없어진 테마 이름은 기본값으로 되돌린다', () => {
    localStorage.setItem('davis.theme', 'midnight')

    const { result } = renderHook(() => useTheme())
    expect(result.current.choice).toBe('dark')
  })

  it('알 수 없는 값도 기본값으로 되돌린다', () => {
    localStorage.setItem('davis.theme', '이상한값')

    const { result } = renderHook(() => useTheme())
    expect(result.current.choice).toBe('dark')
  })
})
