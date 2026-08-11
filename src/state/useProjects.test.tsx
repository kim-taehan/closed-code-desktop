// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjects } from './useProjects'
import type { ProjectStatePayload, ProjectOpenResultPayload } from '../../shared/ipc/channels'
import type { ProjectRecord } from '../../shared/projects/projectRecord'

// 프로젝트 목록 상태. 첫 목록을 직접 가져오고, 구독으로 갱신하며, 열기 실패 사유를 담는다.

function rec(id: string): ProjectRecord {
  return { id, root: `/r/${id}`, name: id, favorite: false, lastOpenedAt: 0 }
}
function state(ids: string[], activeId: string | null = null): ProjectStatePayload {
  const all = ids.map(rec)
  return { all, open: all, activeId }
}

type ProjHandler = (p: ProjectStatePayload) => void
let handler: ProjHandler | undefined
const unsub = vi.fn()
const listProjects = vi.fn<() => Promise<ProjectStatePayload>>()
const pickProject = vi.fn<() => Promise<ProjectOpenResultPayload>>()
const openProject = vi.fn<(args: { root: string }) => Promise<ProjectOpenResultPayload>>()
const activateProject = vi.fn(() => Promise.resolve())
const closeProject = vi.fn(() => Promise.resolve())
const renameProject = vi.fn(() => Promise.resolve())
const favoriteProject = vi.fn(() => Promise.resolve())

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  handler = undefined
  ;[unsub, listProjects, pickProject, openProject, activateProject, closeProject, renameProject, favoriteProject].forEach(
    (m) => m.mockClear(),
  )
  listProjects.mockResolvedValue(state([]))
  ;(window as unknown as { davis: unknown }).davis = {
    onProjectState: (h: ProjHandler) => {
      handler = h
      return unsub
    },
    listProjects,
    pickProject,
    openProject,
    activateProject,
    closeProject,
    renameProject,
    favoriteProject,
  }
})
afterEach(() => vi.restoreAllMocks())

describe('프로젝트 목록', () => {
  it('첫 목록이 오기 전엔 loaded 가 거짓', () => {
    const { result } = renderHook(() => useProjects())
    expect(result.current.loaded).toBe(false)
    expect(result.current.all).toEqual([])
  })

  it('listProjects 결과로 상태와 loaded 를 채운다', async () => {
    listProjects.mockResolvedValue(state(['p1'], 'p1'))
    const { result } = renderHook(() => useProjects())
    await flush()
    expect(result.current.loaded).toBe(true)
    expect(result.current.activeId).toBe('p1')
    expect(result.current.all.map((p) => p.id)).toEqual(['p1'])
  })

  it('구독으로 밀려온 상태를 반영한다', async () => {
    const { result } = renderHook(() => useProjects())
    await flush()
    act(() => handler!(state(['a', 'b'], 'b')))
    expect(result.current.all.map((p) => p.id)).toEqual(['a', 'b'])
    expect(result.current.activeId).toBe('b')
  })

  it('pick 성공은 true 를 주고 오류를 지운다', async () => {
    pickProject.mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useProjects())
    await flush()
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.pick()
    })
    expect(ok).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('pick 실패는 false 를 주고 사유를 담는다', async () => {
    pickProject.mockResolvedValue({ ok: false, message: '5개까지만 열 수 있습니다' })
    const { result } = renderHook(() => useProjects())
    await flush()
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.pick()
    })
    expect(ok).toBe(false)
    expect(result.current.error).toBe('5개까지만 열 수 있습니다')
  })

  it('취소(사유 없는 실패)는 오류를 남기지 않는다', async () => {
    pickProject.mockResolvedValue({ ok: false })
    const { result } = renderHook(() => useProjects())
    await flush()
    await act(async () => {
      await result.current.pick()
    })
    expect(result.current.error).toBeNull()
  })

  it('openRoot 는 root 를 넘겨 연다', async () => {
    openProject.mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useProjects())
    await flush()
    await act(async () => {
      await result.current.openRoot('/some/path')
    })
    expect(openProject).toHaveBeenCalledWith({ root: '/some/path' })
  })

  it('dismissError 로 사유를 지운다', async () => {
    pickProject.mockResolvedValue({ ok: false, message: '실패' })
    const { result } = renderHook(() => useProjects())
    await flush()
    await act(async () => {
      await result.current.pick()
    })
    expect(result.current.error).toBe('실패')
    act(() => result.current.dismissError())
    expect(result.current.error).toBeNull()
  })

  it('activate/close/rename/favorite 는 알맞은 IPC 를 부른다', async () => {
    const { result } = renderHook(() => useProjects())
    await flush()
    act(() => result.current.activate('p1'))
    act(() => result.current.close('p2'))
    act(() => result.current.rename('p3', '새 이름'))
    act(() => result.current.favorite('p4', true))
    expect(activateProject).toHaveBeenCalledWith({ id: 'p1' })
    expect(closeProject).toHaveBeenCalledWith({ id: 'p2' })
    expect(renameProject).toHaveBeenCalledWith({ id: 'p3', name: '새 이름' })
    expect(favoriteProject).toHaveBeenCalledWith({ id: 'p4', favorite: true })
  })

  it('언마운트하면 구독을 끊는다', async () => {
    const { unmount } = renderHook(() => useProjects())
    await flush()
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })
})
