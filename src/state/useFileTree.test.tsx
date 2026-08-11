// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileTree } from './useFileTree'
import type { DirEntryPayload, ReadDirResultPayload } from '../../shared/ipc/channels'

// 파일 트리(지연 확장). 펼친 디렉토리만 읽고, 프로젝트가 바뀌면 통째로 버린다.

const readDir = vi.fn<(args: { projectId: string; path: string }) => Promise<ReadDirResultPayload>>()

function entry(name: string, isDirectory = false): DirEntryPayload {
  return { name, path: name, isDirectory }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  readDir.mockReset()
  readDir.mockResolvedValue({ ok: true, entries: [entry('a.ts')] })
  ;(window as unknown as { davis: unknown }).davis = { readDir }
})
afterEach(() => vi.restoreAllMocks())

describe('파일 트리', () => {
  it('마운트하면 루트를 읽는다', async () => {
    const { result } = renderHook(() => useFileTree('A'))
    await flush()
    expect(readDir).toHaveBeenCalledWith({ projectId: 'A', path: '' })
    expect(result.current.children['']).toEqual([entry('a.ts')])
  })

  it('프로젝트가 null 이면 아무 것도 읽지 않는다', () => {
    const { result } = renderHook(() => useFileTree(null))
    expect(readDir).not.toHaveBeenCalled()
    expect(result.current.children).toEqual({})
  })

  it('폴더를 펼치면 그 디렉토리를 읽는다', async () => {
    const { result } = renderHook(() => useFileTree('A'))
    await flush()
    readDir.mockResolvedValue({ ok: true, entries: [entry('nested.ts')] })
    await act(async () => {
      result.current.toggle('src')
      await Promise.resolve()
    })
    expect(result.current.expanded.has('src')).toBe(true)
    expect(readDir).toHaveBeenCalledWith({ projectId: 'A', path: 'src' })
    expect(result.current.children['src']).toEqual([entry('nested.ts')])
  })

  it('접었다가 다시 펴도 이미 읽은 디렉토리는 다시 읽지 않는다', async () => {
    const { result } = renderHook(() => useFileTree('A'))
    await flush()
    await act(async () => {
      result.current.toggle('src')
      await Promise.resolve()
    })
    const callsAfterFirstExpand = readDir.mock.calls.length
    // 접기
    act(() => result.current.toggle('src'))
    expect(result.current.expanded.has('src')).toBe(false)
    // 다시 펴기 — children 에 캐시가 있어 readDir 를 또 부르지 않는다
    act(() => result.current.toggle('src'))
    expect(result.current.expanded.has('src')).toBe(true)
    expect(readDir.mock.calls.length).toBe(callsAfterFirstExpand)
  })

  it('프로젝트가 바뀌면 트리를 새로 시작하고 새 루트를 읽는다', async () => {
    const { result, rerender } = renderHook(({ id }) => useFileTree(id), {
      initialProps: { id: 'A' as string | null },
    })
    await flush()
    await act(async () => {
      result.current.toggle('src')
      await Promise.resolve()
    })
    expect(result.current.children['src']).toBeDefined()

    readDir.mockResolvedValue({ ok: true, entries: [entry('b.ts')] })
    rerender({ id: 'B' })
    await flush()
    // 이전 프로젝트의 하위 트리가 남지 않는다
    expect(result.current.children['src']).toBeUndefined()
    expect(result.current.children['']).toEqual([entry('b.ts')])
    expect(result.current.expanded.size).toBe(0)
  })

  it('읽는 동안 프로젝트가 바뀌면 늦게 온 결과를 버린다 — 남의 트리를 섞지 않는다', async () => {
    // 루트 읽기를 수동으로 붙잡아 둔다
    let resolveRoot!: (r: ReadDirResultPayload) => void
    readDir.mockImplementationOnce(
      () => new Promise<ReadDirResultPayload>((r) => (resolveRoot = r)),
    )
    const { result, rerender } = renderHook(({ id }) => useFileTree(id), {
      initialProps: { id: 'A' as string | null },
    })
    // A 루트 응답이 오기 전에 B 로 옮긴다
    rerender({ id: 'B' })
    await flush()
    // 뒤늦게 A 응답 도착 → id !== projectId 이므로 버려야 한다
    await act(async () => {
      resolveRoot({ ok: true, entries: [entry('stale-A.ts')] })
      await Promise.resolve()
    })
    expect(result.current.children['']).not.toEqual([entry('stale-A.ts')])
  })

  it('읽는 동안 loading 에 경로가 담긴다', async () => {
    let resolveDir!: (r: ReadDirResultPayload) => void
    readDir.mockImplementationOnce(
      () => new Promise<ReadDirResultPayload>((r) => (resolveDir = r)),
    )
    const { result } = renderHook(() => useFileTree('A'))
    // 루트 읽기가 아직 안 끝났으므로 loading 에 '' 가 있다
    expect(result.current.loading.has('')).toBe(true)
    await act(async () => {
      resolveDir({ ok: true, entries: [] })
      await Promise.resolve()
    })
    expect(result.current.loading.has('')).toBe(false)
  })
})
