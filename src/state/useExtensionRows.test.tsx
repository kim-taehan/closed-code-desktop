// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useExtensionRows } from './useExtensionRows'

// 확장 결과 상태. IPC 는 부르지 않는다 — 밀려온 것을 받아 담기만 한다.

describe('확장 결과 담기', () => {
  it('처음에는 비어 있다', () => {
    const { result } = renderHook(() => useExtensionRows('p1'))

    expect(result.current.rowsByView).toEqual({})
  })

  it('뷰 id 별로 담는다', () => {
    const { result } = renderHook(() => useExtensionRows('p1'))

    act(() => result.current.apply('p1', 'todo.results', [{ file: 'a.ts' }]))
    act(() => result.current.apply('p1', 'other.results', [{ file: 'b.ts' }]))

    expect(result.current.rowsByView).toEqual({
      'todo.results': [{ file: 'a.ts' }],
      'other.results': [{ file: 'b.ts' }],
    })
  })

  // setRows 는 이어붙이기가 아니라 통째 교체다 (계획서 §2.4).
  // 이어붙이면 명령을 다시 돌릴 때마다 이미 고친 TODO 가 계속 쌓인다.
  it('같은 뷰에 다시 오면 덮어쓴다', () => {
    const { result } = renderHook(() => useExtensionRows('p1'))

    act(() => result.current.apply('p1', 'todo.results', [{ file: 'a.ts' }, { file: 'b.ts' }]))
    act(() => result.current.apply('p1', 'todo.results', [{ file: 'c.ts' }]))

    expect(result.current.rowsByView['todo.results']).toEqual([{ file: 'c.ts' }])
  })
})

describe('프로젝트 경계', () => {
  // 다른 탭의 결과를 이 화면에 그리면 안 된다 (useGitState.ts:58-65 와 같은 규칙)
  it('겉봉의 프로젝트가 다르면 버린다', () => {
    const { result } = renderHook(() => useExtensionRows('p1'))

    act(() => result.current.apply('p2', 'todo.results', [{ file: '남의것.ts' }]))

    expect(result.current.rowsByView).toEqual({})
  })

  it('프로젝트가 바뀌면 그 프로젝트 것만 보인다', () => {
    const { result, rerender } = renderHook(({ id }) => useExtensionRows(id), {
      initialProps: { id: 'p1' as string | null },
    })
    act(() => result.current.apply('p1', 'todo.results', [{ file: 'a.ts' }]))
    expect(result.current.rowsByView['todo.results']).toHaveLength(1)

    rerender({ id: 'p2' })

    expect(result.current.rowsByView).toEqual({})
  })

  // 비우지 않고 나눠 쥐는 이유 — 돌아왔을 때 화면이 처음 상태로 되돌아가면
  // 트리는 통째로 접히고 표는 「아직 실행하지 않았습니다」로 깜빡인다.
  it('다녀왔다 돌아오면 그대로 있다', () => {
    const { result, rerender } = renderHook(({ id }) => useExtensionRows(id), {
      initialProps: { id: 'p1' as string | null },
    })
    act(() => result.current.apply('p1', 'todo.results', [{ file: 'a.ts' }]))

    rerender({ id: 'p2' })
    rerender({ id: 'p1' })

    expect(result.current.rowsByView['todo.results']).toEqual([{ file: 'a.ts' }])
  })

  it('다녀온 프로젝트의 것이 섞이지 않는다', () => {
    const { result, rerender } = renderHook(({ id }) => useExtensionRows(id), {
      initialProps: { id: 'p1' as string | null },
    })
    act(() => result.current.apply('p1', 'todo.results', [{ file: 'a.ts' }]))

    rerender({ id: 'p2' })
    act(() => result.current.apply('p2', 'todo.results', [{ file: 'b.ts' }]))
    rerender({ id: 'p1' })

    expect(result.current.rowsByView['todo.results']).toEqual([{ file: 'a.ts' }])
  })

  it('프로젝트가 없으면 아무것도 담지 않는다', () => {
    const { result } = renderHook(() => useExtensionRows(null))

    act(() => result.current.apply('p1', 'todo.results', [{ file: 'a.ts' }]))

    expect(result.current.rowsByView).toEqual({})
  })
})
