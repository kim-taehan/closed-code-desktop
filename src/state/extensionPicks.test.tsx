// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useExtensionPicks } from './extensionPicks'
import type { TreeNode } from './extensionTree'

// 트리에서 고른 것. 명령에 실려 나가므로 **화면에 없는 것이 남아 있으면 안 되고**,
// 다른 프로젝트에 다녀왔다는 이유로 사라져도 안 된다.

const P1: Record<string, TreeNode[]> = {
  'ts.apis': [{ id: 'agents', label: 'agents', children: [{ id: 'GET /agent', label: 'GET /agent' }] }],
}
const P2: Record<string, TreeNode[]> = {
  'ts.apis': [{ id: 'alarm', label: 'alarm', children: [{ id: 'GET /alarm', label: 'GET /alarm' }] }],
}

describe('고른 것 담기', () => {
  it('뷰별로 쥐되 합쳐서 내보낸다', () => {
    const { result } = renderHook(() => useExtensionPicks('p1', P1))

    act(() => result.current.set('ts.apis', new Set(['GET /agent'])))
    act(() => result.current.set('ts.screens', new Set(['src/A.tsx'])))

    expect(result.current.of('ts.apis')).toEqual(new Set(['GET /agent']))
    expect([...result.current.selection].sort()).toEqual(['GET /agent', 'src/A.tsx'])
  })

  // 남겨 두면 화면에 없는 것이 명령에 실린다 — 사용자는 고른 적 없는 대상의 결과를 받는다
  it('목록에서 사라진 것은 걸러낸다', () => {
    const { result, rerender } = renderHook(({ trees }) => useExtensionPicks('p1', trees), {
      initialProps: { trees: P1 },
    })
    act(() => result.current.set('ts.apis', new Set(['GET /agent'])))

    rerender({ trees: { 'ts.apis': [{ id: 'agents', label: 'agents', children: [] }] } })

    expect(result.current.of('ts.apis').size).toBe(0)
  })
})

describe('프로젝트 경계', () => {
  // 프로젝트로 가르기 전에는, 저쪽에서 같은 뷰를 한 번이라도 돌렸으면
  // 위의 걸러내기가 저쪽 트리를 기준으로 돌아 이쪽 선택이 통째로 잘려 나갔다.
  it('다녀왔다 돌아오면 고른 그대로다', () => {
    const { result, rerender } = renderHook(({ id, trees }) => useExtensionPicks(id, trees), {
      initialProps: { id: 'p1' as string | null, trees: P1 },
    })
    act(() => result.current.set('ts.apis', new Set(['GET /agent'])))

    rerender({ id: 'p2', trees: P2 })
    expect(result.current.of('ts.apis').size).toBe(0)

    rerender({ id: 'p1', trees: P1 })
    expect(result.current.of('ts.apis')).toEqual(new Set(['GET /agent']))
  })

  it('저쪽에서 고른 것이 명령에 실리지 않는다', () => {
    const { result, rerender } = renderHook(({ id, trees }) => useExtensionPicks(id, trees), {
      initialProps: { id: 'p1' as string | null, trees: P1 },
    })

    rerender({ id: 'p2', trees: P2 })
    act(() => result.current.set('ts.apis', new Set(['GET /alarm'])))
    rerender({ id: 'p1', trees: P1 })

    expect(result.current.selection).toEqual([])
  })
})
