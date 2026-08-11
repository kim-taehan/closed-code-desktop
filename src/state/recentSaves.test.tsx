// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecentSaves } from './recentSaves'

// autoContext 의 재료. vscode RecentFileTracker 를 미러한다 —
// 저장 시점으로 잡고(열기·타이핑 아님), 20개까지 추적해 최근 10개만 보낸다.

describe('useRecentSaves', () => {
  it('최근에 저장한 것이 앞에 온다', () => {
    const { result } = renderHook(() => useRecentSaves())
    act(() => {
      result.current.record('a.ts')
      result.current.record('b.ts')
    })
    expect(result.current.recent()).toEqual(['b.ts', 'a.ts'])
  })

  it('같은 파일을 다시 저장하면 맨 앞으로 온다', () => {
    // 순서가 뜻이다 — 다시 손댄 파일이 더 최근이다
    const { result } = renderHook(() => useRecentSaves())
    act(() => {
      result.current.record('a.ts')
      result.current.record('b.ts')
      result.current.record('a.ts')
    })
    expect(result.current.recent()).toEqual(['a.ts', 'b.ts'])
  })

  it('활성 편집기는 뺀다', () => {
    // activeEditor 로 따로 실린다 — 같은 파일을 두 번 말할 이유가 없다
    const { result } = renderHook(() => useRecentSaves())
    act(() => {
      result.current.record('a.ts')
      result.current.record('b.ts')
    })
    expect(result.current.recent('b.ts')).toEqual(['a.ts'])
  })

  it('한 번에 10개까지만 보낸다', () => {
    const { result } = renderHook(() => useRecentSaves())
    act(() => {
      for (let i = 0; i < 15; i += 1) result.current.record(`f${i}.ts`)
    })
    expect(result.current.recent()).toHaveLength(10)
    expect(result.current.recent()[0], '가장 최근 것이 빠졌다').toBe('f14.ts')
  })

  it('20개를 넘으면 오래된 것부터 버린다', () => {
    const { result } = renderHook(() => useRecentSaves())
    act(() => {
      for (let i = 0; i < 25; i += 1) result.current.record(`f${i}.ts`)
    })
    // f0~f4 는 밀려났다. 남은 것 중 가장 오래된 것은 f5 다.
    act(() => {
      result.current.record('f5.ts')
    })
    expect(result.current.recent()[0]).toBe('f5.ts')
  })

  it('git 가짜 탭은 기록하지 않는다', () => {
    // `git:staged:...` 는 실제 파일이 아니다
    const { result } = renderHook(() => useRecentSaves())
    act(() => {
      result.current.record('git:staged:a.ts')
      result.current.record('a.ts')
    })
    expect(result.current.recent()).toEqual(['a.ts'])
  })

  it('프로젝트를 옮기면 비운다', () => {
    // 남의 프로젝트 경로가 따라가면 안 된다
    const { result } = renderHook(() => useRecentSaves())
    act(() => {
      result.current.record('a.ts')
      result.current.clear()
    })
    expect(result.current.recent()).toEqual([])
  })
})
