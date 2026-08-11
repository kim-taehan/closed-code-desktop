// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitState } from './useGitState'
import { EMPTY_GIT_STATE, type GitState } from '../../shared/git/gitState'
import type { GitStatePayload, GitActionResult } from '../../shared/ipc/gitPayloads'

// 소스 관리 상태 구독. 프로젝트가 바뀌면 통째로 비우고, 겉봉 projectId 로 남의 저장소를 걸러낸다.

function mkState(branch: string): GitState {
  return { ...EMPTY_GIT_STATE, isRepo: true, branch }
}

type GitHandler = (payload: GitStatePayload, id: string) => void
let handler: GitHandler | undefined
const unsub = vi.fn()

const gitState = vi.fn<(args: { projectId: string }) => Promise<GitStatePayload>>()
const gitStage = vi.fn(() => Promise.resolve({ ok: true } as GitActionResult))
const gitUnstage = vi.fn(() => Promise.resolve({ ok: true } as GitActionResult))
const gitRevert = vi.fn(() => Promise.resolve({ ok: true } as GitActionResult))
const gitCommit = vi.fn(() => Promise.resolve({ ok: true } as GitActionResult))
const gitPush = vi.fn(() => Promise.resolve({ ok: true } as GitActionResult))
const gitPull = vi.fn(() => Promise.resolve({ ok: true } as GitActionResult))
const gitRefresh = vi.fn(() => Promise.resolve())

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  handler = undefined
  ;[unsub, gitState, gitStage, gitUnstage, gitRevert, gitCommit, gitPush, gitPull, gitRefresh].forEach(
    (m) => m.mockClear(),
  )
  gitState.mockResolvedValue({ state: mkState('main') })
  ;(window as unknown as { davis: unknown }).davis = {
    gitState,
    onGitState: (h: GitHandler) => {
      handler = h
      return unsub
    },
    gitStage,
    gitUnstage,
    gitRevert,
    gitCommit,
    gitPush,
    gitPull,
    gitRefresh,
  }
})
afterEach(() => vi.restoreAllMocks())

describe('git 상태', () => {
  it('처음엔 빈 상태로 시작해 조회 결과로 채운다', async () => {
    const { result } = renderHook(() => useGitState('A', true))
    expect(result.current.state).toEqual(EMPTY_GIT_STATE)
    await flush()
    expect(gitState).toHaveBeenCalledWith({ projectId: 'A' })
    expect(result.current.state.branch).toBe('main')
    expect(result.current.loading).toBe(false)
  })

  it('프로젝트가 null 이면 조회하지 않고 빈 상태다', () => {
    const { result } = renderHook(() => useGitState(null, true))
    expect(gitState).not.toHaveBeenCalled()
    expect(result.current.state).toEqual(EMPTY_GIT_STATE)
  })

  it('비활성이면 조회하지 않는다', () => {
    const { result } = renderHook(() => useGitState('A', false))
    expect(gitState).not.toHaveBeenCalled()
    expect(result.current.state).toEqual(EMPTY_GIT_STATE)
  })

  it('내 프로젝트로 밀려온 변화를 반영한다', async () => {
    const { result } = renderHook(() => useGitState('A', true))
    await flush()
    act(() => handler!({ state: mkState('feature') }, 'A'))
    expect(result.current.state.branch).toBe('feature')
  })

  it('다른 프로젝트로 밀려온 변화는 버린다', async () => {
    const { result } = renderHook(() => useGitState('A', true))
    await flush()
    act(() => handler!({ state: mkState('남의-브랜치') }, 'B'))
    expect(result.current.state.branch).toBe('main')
  })

  it('프로젝트가 바뀌면 새 답이 오기 전에 즉시 비운다', async () => {
    let resolveB!: (p: GitStatePayload) => void
    const { result, rerender } = renderHook(({ id }) => useGitState(id, true), {
      initialProps: { id: 'A' as string | null },
    })
    await flush()
    expect(result.current.state.branch).toBe('main')
    // B 조회는 붙잡아 둔다
    gitState.mockImplementationOnce(
      () => new Promise<GitStatePayload>((r) => (resolveB = r)),
    )
    rerender({ id: 'B' })
    // 아직 B 답이 안 왔지만 A 상태는 이미 비워졌다
    expect(result.current.state).toEqual(EMPTY_GIT_STATE)
    await act(async () => {
      resolveB({ state: mkState('b-branch') })
      await Promise.resolve()
    })
    expect(result.current.state.branch).toBe('b-branch')
  })

  it('늦게 온 이전 프로젝트의 답은 버린다', async () => {
    let resolveA!: (p: GitStatePayload) => void
    gitState.mockImplementationOnce(
      () => new Promise<GitStatePayload>((r) => (resolveA = r)),
    )
    const { result, rerender } = renderHook(({ id }) => useGitState(id, true), {
      initialProps: { id: 'A' as string | null },
    })
    gitState.mockResolvedValue({ state: mkState('b-branch') })
    rerender({ id: 'B' })
    await flush()
    expect(result.current.state.branch).toBe('b-branch')
    // 뒤늦게 A 응답 도착 → alive=false 라 버린다
    await act(async () => {
      resolveA({ state: mkState('stale-A') })
      await Promise.resolve()
    })
    expect(result.current.state.branch).toBe('b-branch')
  })

  it('toggle 은 담기/빼기에 맞는 IPC 를 부른다', async () => {
    const { result } = renderHook(() => useGitState('A', true))
    await flush()
    await act(async () => {
      await result.current.toggle('f.ts', true)
    })
    expect(gitStage).toHaveBeenCalledWith({ projectId: 'A', path: 'f.ts' })
    await act(async () => {
      await result.current.toggle('f.ts', false)
    })
    expect(gitUnstage).toHaveBeenCalledWith({ projectId: 'A', path: 'f.ts' })
  })

  it('변경 행동은 projectId 를 실어 보낸다', async () => {
    const { result } = renderHook(() => useGitState('A', true))
    await flush()
    await act(async () => {
      await result.current.revert('f.ts')
      await result.current.commit('메시지')
      await result.current.push(true)
      await result.current.pull()
    })
    expect(gitRevert).toHaveBeenCalledWith({ projectId: 'A', path: 'f.ts' })
    expect(gitCommit).toHaveBeenCalledWith({ projectId: 'A', message: '메시지' })
    expect(gitPush).toHaveBeenCalledWith({ projectId: 'A', setUpstream: true })
    expect(gitPull).toHaveBeenCalledWith({ projectId: 'A' })
  })

  it('프로젝트가 없으면 변경 행동은 IPC 없이 실패를 준다', async () => {
    const { result } = renderHook(() => useGitState(null, true))
    const revert = await result.current.revert('f.ts')
    const commit = await result.current.commit('m')
    const push = await result.current.push(false)
    const pull = await result.current.pull()
    expect(revert).toEqual({ ok: false, message: '프로젝트가 없습니다' })
    expect(commit.ok).toBe(false)
    expect(push.ok).toBe(false)
    expect(pull.ok).toBe(false)
    expect(gitRevert).not.toHaveBeenCalled()
    expect(gitCommit).not.toHaveBeenCalled()
  })

  it('refetch 는 gitRefresh 를 부른다', async () => {
    const { result } = renderHook(() => useGitState('A', true))
    await flush()
    act(() => result.current.refetch())
    expect(gitRefresh).toHaveBeenCalledWith({ projectId: 'A' })
  })

  it('refresh 는 같은 프로젝트를 다시 조회한다 (nonce)', async () => {
    const { result } = renderHook(() => useGitState('A', true))
    await flush()
    expect(gitState).toHaveBeenCalledTimes(1)
    await act(async () => {
      result.current.refresh()
      await Promise.resolve()
    })
    expect(gitState).toHaveBeenCalledTimes(2)
  })

  it('언마운트하면 구독을 끊는다', async () => {
    const { unmount } = renderHook(() => useGitState('A', true))
    await flush()
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })
})
