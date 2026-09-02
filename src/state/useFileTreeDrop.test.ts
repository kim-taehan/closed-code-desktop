// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFileTreeDrop } from './useFileTreeDrop'

function makeDropEvent(types: string[], path?: string) {
  return {
    dataTransfer: {
      types,
      getData: () => path ?? '',
    },
    preventDefault: vi.fn(),
  }
}

function makeDragOverEvent(types: string[]) {
  return {
    dataTransfer: { types },
    preventDefault: vi.fn(),
  }
}

describe('useFileTreeDrop', () => {
  it('text/plain 이 없으면 over 가 되지 않는다', () => {
    const onInsert = vi.fn()
    const { result } = renderHook(() => useFileTreeDrop(onInsert))

    act(() => {
      result.current.handlers.onDragOver(makeDragOverEvent(['Files']) as never)
    })
    expect(result.current.over).toBe(false)
  })

  it('text/plain 이 있으면 over 가 되고 drop 시 경로를 전달한다', () => {
    const onInsert = vi.fn()
    const { result } = renderHook(() => useFileTreeDrop(onInsert))

    act(() => {
      result.current.handlers.onDragOver(makeDragOverEvent(['text/plain']) as never)
    })
    expect(result.current.over).toBe(true)

    act(() => {
      result.current.handlers.onDrop(makeDropEvent(['text/plain'], 'src/main.ts') as never)
    })
    expect(onInsert).toHaveBeenCalledWith('src/main.ts')
    expect(result.current.over).toBe(false)
  })

  it('빈 경로면 무시한다', () => {
    const onInsert = vi.fn()
    const { result } = renderHook(() => useFileTreeDrop(onInsert))

    act(() => {
      result.current.handlers.onDragOver(makeDragOverEvent(['text/plain']) as never)
    })
    act(() => {
      result.current.handlers.onDrop(makeDropEvent(['text/plain'], '') as never)
    })
    expect(onInsert).not.toHaveBeenCalled()
  })
})
