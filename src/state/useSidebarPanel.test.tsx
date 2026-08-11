// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSidebarPanel } from './useSidebarPanel'

// 사이드바 선택이 **프로젝트마다 따로**인가.

describe('사이드바 패널 선택 (프로젝트별)', () => {
  it('아무것도 고른 적 없으면 프로젝트를 본다', () => {
    const { result } = renderHook(() => useSidebarPanel('p1'))

    expect(result.current.panel).toBe('files')
  })

  it('다른 프로젝트로 옮기면 그 프로젝트의 기본값이 뜬다 — 앞 선택이 따라오지 않는다', () => {
    const { result, rerender } = renderHook(({ id }) => useSidebarPanel(id), {
      initialProps: { id: 'p1' },
    })
    act(() => result.current.select('git'))
    expect(result.current.panel).toBe('git')

    rerender({ id: 'p2' })

    expect(result.current.panel).toBe('files')
  })

  it('돌아오면 그 프로젝트에서 보던 것이 그대로다', () => {
    const { result, rerender } = renderHook(({ id }) => useSidebarPanel(id), {
      initialProps: { id: 'p1' },
    })
    act(() => result.current.select('history'))

    rerender({ id: 'p2' })
    act(() => result.current.select('git'))
    rerender({ id: 'p1' })

    expect(result.current.panel).toBe('history')

    rerender({ id: 'p2' })
    expect(result.current.panel).toBe('git')
  })

  it('확장이 등록한 패널도 프로젝트마다 따로 기억한다', () => {
    const { result, rerender } = renderHook(({ id }) => useSidebarPanel(id), {
      initialProps: { id: 'p1' },
    })

    act(() => result.current.select('ext:sample-ext:sampleExt.results'))
    rerender({ id: 'p2' })
    expect(result.current.panel).toBe('files')

    rerender({ id: 'p1' })
    expect(result.current.panel).toBe('ext:sample-ext:sampleExt.results')
  })
})
