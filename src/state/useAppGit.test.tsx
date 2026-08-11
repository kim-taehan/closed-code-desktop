// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppGit } from './useAppGit'
import { EMPTY_GIT_STATE, type GitState } from '../../shared/git/gitState'
import type { ToastApi } from './useToasts'

// App 의 git 배선 한 묶음. 여기가 어긋나면 사이드바가 조용히 죽는다.
//
// 잠그는 것:
//  1. 프로젝트가 바뀌면 상태·브랜치 메뉴가 **즉시** 비워진다 (남의 저장소를 잠깐 보이지 않는다)
//  2. 프로젝트가 없으면 아무것도 묻지 않고, 메뉴를 눌러도 아무 일이 없다
//  3. 브랜치 메뉴는 **로컬만** 준다 (원격은 받아오기가 따로다)
//  4. 메뉴가 실제로 전환·생성 IPC 를 부르고, 그 뒤 목록을 다시 읽는다
//  5. 턴이 끝나는 순간(스트리밍 참→거짓)에만 git 을 다시 읽는다

function mkState(branch: string): GitState {
  return { ...EMPTY_GIT_STATE, isRepo: true, branch }
}

const local = (name: string, current = false) => ({
  name,
  remote: false,
  date: '',
  track: '',
  current,
})
const remote = (name: string) => ({ name, remote: true, date: '', track: '', current: false })

const gitState = vi.fn()
const gitBranches = vi.fn()
const gitStashes = vi.fn()
const gitSwitchBranch = vi.fn()
const gitCreateBranch = vi.fn()
const gitStageAll = vi.fn()
const gitUnstageAll = vi.fn()
const gitCommit = vi.fn()
const onGitState = vi.fn(() => () => {})

const toasts: ToastApi = { toasts: [], show: vi.fn(), dismiss: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  gitState.mockResolvedValue({ state: mkState('main') })
  gitBranches.mockResolvedValue({ ok: true, branches: [local('main', true), remote('origin/feat')] })
  gitStashes.mockResolvedValue({ ok: true, stashes: [] })
  gitSwitchBranch.mockResolvedValue({ ok: true })
  gitCreateBranch.mockResolvedValue({ ok: true })
  gitStageAll.mockResolvedValue({ ok: true })
  gitUnstageAll.mockResolvedValue({ ok: true })
  gitCommit.mockResolvedValue({ ok: true })
  ;(window as unknown as { davis: unknown }).davis = {
    gitState,
    onGitState,
    gitBranches,
    gitStashes,
    gitSwitchBranch,
    gitCreateBranch,
    gitStageAll,
    gitUnstageAll,
    gitCommit,
  }
})

describe('useAppGit', () => {
  it('프로젝트를 물어 상태와 브랜치 메뉴를 채운다', async () => {
    const { result } = renderHook(() => useAppGit('A', toasts, false))

    await waitFor(() => expect(result.current.git.state.branch).toBe('main'))
    await waitFor(() => expect(result.current.branchMenu.branches).toHaveLength(1))
    expect(gitState).toHaveBeenCalledWith({ projectId: 'A' })
    expect(gitBranches).toHaveBeenCalledWith({ projectId: 'A' })
  })

  // 🔴 원격을 넣으면 칩 메뉴에서 `origin/feat` 를 골라 전환하게 되는데,
  //    전환은 로컬 이름만 받는다 — 받아오기(track)는 채널이 따로다.
  it('브랜치 메뉴는 로컬만 준다', async () => {
    const { result } = renderHook(() => useAppGit('A', toasts, false))

    await waitFor(() => expect(result.current.branchMenu.branches).toHaveLength(1))
    expect(result.current.branchMenu.branches.map((b) => b.name)).toEqual(['main'])
  })

  it('프로젝트가 바뀌면 상태와 메뉴를 즉시 비운다', async () => {
    const { result, rerender } = renderHook(({ id }) => useAppGit(id, toasts, false), {
      initialProps: { id: 'A' as string | null },
    })
    await waitFor(() => expect(result.current.git.state.branch).toBe('main'))
    await waitFor(() => expect(result.current.branchMenu.branches).toHaveLength(1))

    // B 의 답은 붙잡아 둔다 — 답이 오기 전 화면을 본다
    gitState.mockReturnValueOnce(new Promise(() => {}))
    gitBranches.mockReturnValueOnce(new Promise(() => {}))
    rerender({ id: 'B' })

    expect(result.current.git.state).toEqual(EMPTY_GIT_STATE)
    expect(result.current.branchMenu.branches).toEqual([])
  })

  it('프로젝트가 없으면 묻지 않고, 메뉴를 눌러도 아무 일이 없다', async () => {
    const { result } = renderHook(() => useAppGit(null, toasts, false))
    await act(async () => await Promise.resolve())

    expect(gitState).not.toHaveBeenCalled()
    expect(gitBranches).not.toHaveBeenCalled()
    expect(result.current.branchMenu.branches).toEqual([])

    await act(async () => {
      result.current.branchMenu.onSwitch('main')
      result.current.branchMenu.onCreate('feat')
      result.current.gitBulk.onStageAll()
      result.current.gitBulk.onUnstageAll()
    })
    expect(gitSwitchBranch).not.toHaveBeenCalled()
    expect(gitCreateBranch).not.toHaveBeenCalled()
    expect(gitStageAll).not.toHaveBeenCalled()
    expect(gitUnstageAll).not.toHaveBeenCalled()
  })

  it('메뉴의 전환은 IPC 를 부르고 목록을 다시 읽는다', async () => {
    const { result } = renderHook(() => useAppGit('A', toasts, false))
    await waitFor(() => expect(result.current.branchMenu.branches).toHaveLength(1))

    gitBranches.mockResolvedValue({ ok: true, branches: [local('feat', true)] })
    await act(async () => result.current.branchMenu.onSwitch('feat'))

    expect(gitSwitchBranch).toHaveBeenCalledWith({ projectId: 'A', name: 'feat' })
    // 목록은 밀려오지 않는다 — 다시 읽지 않으면 메뉴가 옛 브랜치를 계속 보인다
    await waitFor(() => expect(result.current.branchMenu.branches[0]?.name).toBe('feat'))
  })

  it('메뉴의 생성은 IPC 를 부른다', async () => {
    const { result } = renderHook(() => useAppGit('A', toasts, false))
    await waitFor(() => expect(result.current.branchMenu.branches).toHaveLength(1))

    await act(async () => result.current.branchMenu.onCreate('새-가지'))

    expect(gitCreateBranch).toHaveBeenCalledWith({ projectId: 'A', name: '새-가지' })
  })

  it('턴이 끝나면 git 을 다시 읽는다 — 시작할 때는 읽지 않는다', async () => {
    const { result, rerender } = renderHook(({ streaming }) => useAppGit('A', toasts, streaming), {
      initialProps: { streaming: false },
    })
    await waitFor(() => expect(result.current.git.state.branch).toBe('main'))

    // 턴 시작(거짓→참): 다시 읽을 이유가 없다
    gitState.mockResolvedValue({ state: mkState('턴-중') })
    rerender({ streaming: true })
    await act(async () => await Promise.resolve())
    expect(result.current.git.state.branch).toBe('main')

    // 턴 종료(참→거짓): 에이전트가 파일을 고쳤을 수 있어 다시 읽는다
    gitState.mockResolvedValue({ state: mkState('턴-뒤') })
    rerender({ streaming: false })
    await waitFor(() => expect(result.current.git.state.branch).toBe('턴-뒤'))
  })

  it('패널 행동과 묶음 행동을 함께 낸다', async () => {
    const { result } = renderHook(() => useAppGit('A', toasts, false))
    await waitFor(() => expect(result.current.git.state.branch).toBe('main'))

    await act(async () => {
      result.current.gitActions.onCommit('메시지')
      result.current.gitBulk.onStageAll()
    })
    expect(gitCommit).toHaveBeenCalledWith({ projectId: 'A', message: '메시지' })
    expect(gitStageAll).toHaveBeenCalledWith({ projectId: 'A' })
  })
})
