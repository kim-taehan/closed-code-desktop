// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useExtensionExpanded } from './useExtensionExpanded'

// 펼쳐 둔 가지. **그리는 쪽이 쥐면 화면이 사라질 때 같이 죽는다** —
// 프로젝트 탭을 다녀오면 903줄짜리 트리가 통째로 접혀 있었다.

describe('펼쳤다 접기', () => {
  it('처음에는 다 접혀 있다', () => {
    const { result } = renderHook(() => useExtensionExpanded('p1'))

    expect(result.current.of('ts.apis').has('agents')).toBe(false)
  })

  it('같은 것을 다시 누르면 접힌다', () => {
    const { result } = renderHook(() => useExtensionExpanded('p1'))

    act(() => result.current.toggle('ts.apis', 'agents'))
    expect(result.current.of('ts.apis').has('agents')).toBe(true)

    act(() => result.current.toggle('ts.apis', 'agents'))
    expect(result.current.of('ts.apis').has('agents')).toBe(false)
  })

  // 화면 탭과 API 탭은 서로 다른 트리다. 한 탭에서 편 것이 다른 탭의
  // 같은 이름 가지를 펴면, 사용자가 열지 않은 곳이 열려 있다.
  it('뷰가 다르면 따로 센다', () => {
    const { result } = renderHook(() => useExtensionExpanded('p1'))

    act(() => result.current.toggle('ts.apis', 'src'))

    expect(result.current.of('ts.apis').has('src')).toBe(true)
    expect(result.current.of('ts.screens').has('src')).toBe(false)
  })
})

describe('프로젝트 경계', () => {
  // 이 고침의 본체 — 다른 프로젝트에 다녀와도 파고들던 자리가 남아야 한다
  it('다녀왔다 돌아오면 펼친 그대로다', () => {
    const { result, rerender } = renderHook(({ id }) => useExtensionExpanded(id), {
      initialProps: { id: 'p1' as string | null },
    })
    act(() => result.current.toggle('ts.apis', 'agents'))

    rerender({ id: 'p2' })
    expect(result.current.of('ts.apis').has('agents')).toBe(false)

    rerender({ id: 'p1' })
    expect(result.current.of('ts.apis').has('agents')).toBe(true)
  })

  it('저쪽에서 편 것이 이쪽에 보이지 않는다', () => {
    const { result, rerender } = renderHook(({ id }) => useExtensionExpanded(id), {
      initialProps: { id: 'p1' as string | null },
    })

    rerender({ id: 'p2' })
    act(() => result.current.toggle('ts.apis', 'alarm'))
    rerender({ id: 'p1' })

    expect(result.current.of('ts.apis').has('alarm')).toBe(false)
  })

  it('프로젝트가 없으면 아무것도 담지 않는다', () => {
    const { result } = renderHook(() => useExtensionExpanded(null))

    act(() => result.current.toggle('ts.apis', 'agents'))

    expect(result.current.of('ts.apis').has('agents')).toBe(false)
  })
})
