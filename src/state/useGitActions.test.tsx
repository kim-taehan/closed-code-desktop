// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useRevertWithConfirm,
  useFavoriteWithToast,
  useTurnEndRefresh,
  useCommit,
  usePush,
  usePull,
  useGitPanelActions,
} from './useGitActions'
import type { GitStateHandle } from './useGitState'
import type { ToastApi } from './useToasts'
import { EMPTY_GIT_STATE, type GitState } from '../../shared/git/gitState'
import type { GitActionResult } from '../../shared/ipc/gitPayloads'

// 화면 수준 git 행동 — 확인 대화 + 토스트. 확인 취소·성공/실패 분기를 검증한다.

function mkGit(over: Partial<GitStateHandle> = {}, state: Partial<GitState> = {}): GitStateHandle {
  return {
    state: { ...EMPTY_GIT_STATE, ...state },
    loading: false,
    refresh: vi.fn(),
    toggle: vi.fn(() => Promise.resolve()),
    revert: vi.fn(() => Promise.resolve({ ok: true } as GitActionResult)),
    commit: vi.fn(() => Promise.resolve({ ok: true } as GitActionResult)),
    push: vi.fn(() => Promise.resolve({ ok: true } as GitActionResult)),
    pull: vi.fn(() => Promise.resolve({ ok: true } as GitActionResult)),
    refetch: vi.fn(),
    ...over,
  }
}

function mkToasts(): ToastApi {
  return { toasts: [], show: vi.fn(), dismiss: vi.fn() }
}

async function run(cb: () => void) {
  await act(async () => {
    cb()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

describe('되돌리기(확인)', () => {
  it('확인하면 되돌리고 성공 토스트를 띄운다', async () => {
    const git = mkGit()
    const toasts = mkToasts()
    const { result } = renderHook(() => useRevertWithConfirm(git, toasts))
    await run(() => result.current('a.ts'))
    expect(git.revert).toHaveBeenCalledWith('a.ts')
    expect(toasts.show).toHaveBeenCalledWith('a.ts 을 되돌렸습니다')
  })

  it('취소하면 되돌리지 않는다', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const git = mkGit()
    const toasts = mkToasts()
    const { result } = renderHook(() => useRevertWithConfirm(git, toasts))
    await run(() => result.current('a.ts'))
    expect(git.revert).not.toHaveBeenCalled()
  })

  it('실패하면 git 메시지를 오류 토스트로 보여준다', async () => {
    const git = mkGit({ revert: vi.fn(() => Promise.resolve({ ok: false, message: 'error: x' })) })
    const toasts = mkToasts()
    const { result } = renderHook(() => useRevertWithConfirm(git, toasts))
    await run(() => result.current('a.ts'))
    expect(toasts.show).toHaveBeenCalledWith('error: x', 'error')
  })
})

describe('즐겨찾기 토글 토스트', () => {
  it('담으면 담았다고 알린다', () => {
    const favorite = vi.fn()
    const toasts = mkToasts()
    const { result } = renderHook(() => useFavoriteWithToast(favorite, toasts))
    act(() => result.current({ id: 'p1', name: '내 프로젝트', favorite: false }))
    expect(favorite).toHaveBeenCalledWith('p1', true)
    expect(toasts.show).toHaveBeenCalledWith('내 프로젝트 을 즐겨찾기에 담았습니다')
  })

  it('빼면 뺐다고 알린다', () => {
    const favorite = vi.fn()
    const toasts = mkToasts()
    const { result } = renderHook(() => useFavoriteWithToast(favorite, toasts))
    act(() => result.current({ id: 'p1', name: '내 프로젝트', favorite: true }))
    expect(favorite).toHaveBeenCalledWith('p1', false)
    expect(toasts.show).toHaveBeenCalledWith('내 프로젝트 을 즐겨찾기에서 뺐습니다')
  })
})

describe('턴 종료 새로고침', () => {
  it('스트리밍이 참→거짓으로 떨어지면 새로고침한다', () => {
    const refresh = vi.fn()
    const { rerender } = renderHook(({ s }) => useTurnEndRefresh(s, refresh), {
      initialProps: { s: true },
    })
    expect(refresh).not.toHaveBeenCalled()
    rerender({ s: false })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('처음부터 거짓이면 새로고침하지 않는다', () => {
    const refresh = vi.fn()
    renderHook(() => useTurnEndRefresh(false, refresh))
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('커밋', () => {
  it('성공하면 커밋 토스트', async () => {
    const git = mkGit()
    const toasts = mkToasts()
    const { result } = renderHook(() => useCommit(git, toasts))
    await run(() => result.current('메시지'))
    expect(git.commit).toHaveBeenCalledWith('메시지')
    expect(toasts.show).toHaveBeenCalledWith('커밋했습니다')
  })

  it('실패하면 오류 토스트', async () => {
    const git = mkGit({ commit: vi.fn(() => Promise.resolve({ ok: false, message: 'nothing to commit' })) })
    const toasts = mkToasts()
    const { result } = renderHook(() => useCommit(git, toasts))
    await run(() => result.current('메시지'))
    expect(toasts.show).toHaveBeenCalledWith('nothing to commit', 'error')
  })
})

describe('푸시', () => {
  it('업스트림이 있으면 확인 없이 올린다', async () => {
    const git = mkGit({}, { upstream: 'origin/main' })
    const toasts = mkToasts()
    const { result } = renderHook(() => usePush(git, toasts))
    await run(() => result.current())
    expect(window.confirm).not.toHaveBeenCalled()
    expect(git.push).toHaveBeenCalledWith(false)
    expect(toasts.show).toHaveBeenCalledWith('올렸습니다')
  })

  it('업스트림이 없으면 확인받고 만들며 올린다', async () => {
    const git = mkGit({}, { upstream: null })
    const toasts = mkToasts()
    const { result } = renderHook(() => usePush(git, toasts))
    await run(() => result.current())
    expect(window.confirm).toHaveBeenCalled()
    expect(git.push).toHaveBeenCalledWith(true)
  })

  it('업스트림이 없고 취소하면 올리지 않는다', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const git = mkGit({}, { upstream: null })
    const toasts = mkToasts()
    const { result } = renderHook(() => usePush(git, toasts))
    await run(() => result.current())
    expect(git.push).not.toHaveBeenCalled()
  })
})

describe('당겨오기', () => {
  it('성공/실패를 토스트로 알린다', async () => {
    const okGit = mkGit()
    const okToasts = mkToasts()
    const okHook = renderHook(() => usePull(okGit, okToasts))
    await run(() => okHook.result.current())
    expect(okToasts.show).toHaveBeenCalledWith('당겨왔습니다')

    const failGit = mkGit({ pull: vi.fn(() => Promise.resolve({ ok: false, message: 'conflict' })) })
    const failToasts = mkToasts()
    const failHook = renderHook(() => usePull(failGit, failToasts))
    await run(() => failHook.result.current())
    expect(failToasts.show).toHaveBeenCalledWith('conflict', 'error')
  })
})

describe('패널 행동 묶음', () => {
  it('네 가지 행동을 한 묶음으로 준다', async () => {
    const git = mkGit()
    const toasts = mkToasts()
    const { result } = renderHook(() => useGitPanelActions(git, toasts))
    expect(Object.keys(result.current).sort()).toEqual(['onCommit', 'onPull', 'onPush', 'onRevert'])
    await run(() => result.current.onCommit('m'))
    expect(git.commit).toHaveBeenCalledWith('m')
  })
})
