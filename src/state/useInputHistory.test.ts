// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useInputHistory } from './useInputHistory'

// 프로젝트별 입력 기록. 세션 동안만 메모리에 남고, 되짚기 순서(최근이 앞)를 지킨다.

describe('입력 히스토리', () => {
  it('기록하면 최근 것이 앞에 온다', () => {
    const { result } = renderHook(() => useInputHistory('p-order'))
    act(() => result.current.record('첫째'))
    act(() => result.current.record('둘째'))
    expect(result.current.entries).toEqual(['둘째', '첫째'])
  })

  it('앞뒤 공백은 다듬고 빈 입력은 무시한다', () => {
    const { result } = renderHook(() => useInputHistory('p-trim'))
    act(() => result.current.record('  안녕  '))
    act(() => result.current.record('   '))
    expect(result.current.entries).toEqual(['안녕'])
  })

  it('직전과 같은 입력은 겹쳐 쌓지 않는다', () => {
    const { result } = renderHook(() => useInputHistory('p-dup'))
    act(() => result.current.record('같음'))
    act(() => result.current.record('같음'))
    expect(result.current.entries).toEqual(['같음'])
  })

  it('같은 옛 입력을 다시 쓰면 앞으로 끌어올린다', () => {
    const { result } = renderHook(() => useInputHistory('p-bump'))
    act(() => result.current.record('a'))
    act(() => result.current.record('b'))
    act(() => result.current.record('a'))
    expect(result.current.entries).toEqual(['a', 'b'])
  })

  it('프로젝트마다 따로 둔다', () => {
    const first = renderHook(() => useInputHistory('p-1'))
    act(() => first.result.current.record('하나'))
    const second = renderHook(() => useInputHistory('p-2'))
    expect(second.result.current.entries).toEqual([])
  })

  it('프로젝트가 없으면(null) 기록하지 않는다', () => {
    const { result } = renderHook(() => useInputHistory(null))
    act(() => result.current.record('무시됨'))
    expect(result.current.entries).toEqual([])
  })
})
