// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitRefActions } from './useGitRefActions'
import type { GitRefsData, GitRefsHandle } from './useGitRefs'
import type { ToastApi } from './useToasts'
import type { GitStashEntry } from '../../shared/git/gitRefs'

// 브랜치·임시저장 행동이 잠그는 것.
//  1. 되돌릴 수 없는 것(-D · 버리기)은 **확인을 받고 나서야** 부른다
//  2. 안전 삭제(-d)와 강제 삭제(-D)는 **다른 채널**로 간다
//  3. 실패는 git 문구를 그대로 낸다
//  4. 임시저장은 ok:true 를 믿지 않고 **새 목록**으로 판단한다

const api = {
  gitSwitchBranch: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitTrackBranch: vi.fn(),
  gitMergeBranch: vi.fn(),
  gitDeleteBranch: vi.fn(),
  gitForceDeleteBranch: vi.fn(),
  gitStashPush: vi.fn(),
  gitApplyStash: vi.fn(),
  gitDropStash: vi.fn(),
}

function stash(ref: string): GitStashEntry {
  return { ref, date: '', label: `On main: ${ref}` }
}

function mkToasts(): ToastApi {
  return { toasts: [], show: vi.fn(), dismiss: vi.fn() }
}

/** `reload` 가 무엇을 돌려줄지 정해 두는 가짜 목록 */
function mkRefs(stashes: GitStashEntry[] = [], after: GitRefsData | null = null): GitRefsHandle {
  const data: GitRefsData = { branches: [], stashes }
  return {
    ...data,
    loading: false,
    error: null,
    reload: vi.fn().mockResolvedValue(after ?? data),
  }
}

async function settle(cb: () => void) {
  await act(async () => {
    cb()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ ok: true })
  ;(window as unknown as { davis: unknown }).davis = api
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('useGitRefActions — 브랜치', () => {
  it('전환은 이름을 겉봉에 싣고 뒤이어 목록을 다시 읽는다', async () => {
    const refs = mkRefs()
    const { result } = renderHook(() => useGitRefActions('p1', refs, mkToasts()))

    await settle(() => result.current.onSwitch('main'))

    expect(api.gitSwitchBranch).toHaveBeenCalledWith({ projectId: 'p1', name: 'main' })
    expect(refs.reload).toHaveBeenCalled()
  })

  // 🔴 전환이 막히는 것은 흔한 일이다. 우리 말로 바꾸면 사용자가 검색해서 찾을 수 없다.
  it('전환이 막히면 git 문구를 그대로 낸다', async () => {
    api.gitSwitchBranch.mockResolvedValue({
      ok: false,
      message: 'error: Your local changes to the following files would be overwritten…',
    })
    const toasts = mkToasts()
    const { result } = renderHook(() => useGitRefActions('p1', mkRefs(), toasts))

    await settle(() => result.current.onSwitch('main'))

    expect(toasts.show).toHaveBeenCalledWith(
      'error: Your local changes to the following files would be overwritten…',
      'error',
    )
  })

  it('원격 이름은 그대로 넘긴다 — origin/ 을 떼지 않는다 (main 이 뗀다)', async () => {
    const { result } = renderHook(() => useGitRefActions('p1', mkRefs(), mkToasts()))

    await settle(() => result.current.onTrack('origin/feat/x'))

    expect(api.gitTrackBranch).toHaveBeenCalledWith({ projectId: 'p1', name: 'origin/feat/x' })
  })

  // 🔴 두 삭제가 같은 채널로 새면 한 글자 차이로 커밋이 사라진다
  it('안전 삭제는 확인 없이, 강제 삭제는 확인 뒤에 — 서로 다른 채널로 간다', async () => {
    const { result } = renderHook(() => useGitRefActions('p1', mkRefs(), mkToasts()))

    await settle(() => result.current.onDelete('old'))
    expect(api.gitDeleteBranch).toHaveBeenCalledWith({ projectId: 'p1', name: 'old' })
    expect(window.confirm).not.toHaveBeenCalled()
    expect(api.gitForceDeleteBranch).not.toHaveBeenCalled()

    await settle(() => result.current.onForceDelete('old'))
    expect(window.confirm).toHaveBeenCalled()
    expect(api.gitForceDeleteBranch).toHaveBeenCalledWith({ projectId: 'p1', name: 'old' })
  })

  it('강제 삭제 확인을 취소하면 아무것도 하지 않는다', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const { result } = renderHook(() => useGitRefActions('p1', mkRefs(), mkToasts()))

    await settle(() => result.current.onForceDelete('old'))

    expect(api.gitForceDeleteBranch).not.toHaveBeenCalled()
  })

  it('안전 삭제가 "머지 안 됨" 으로 거절되면 그 문구를 그대로 낸다', async () => {
    api.gitDeleteBranch.mockResolvedValue({
      ok: false,
      message: "error: the branch 'old' is not fully merged",
    })
    const toasts = mkToasts()
    const { result } = renderHook(() => useGitRefActions('p1', mkRefs(), toasts))

    await settle(() => result.current.onDelete('old'))

    expect(toasts.show).toHaveBeenCalledWith("error: the branch 'old' is not fully merged", 'error')
  })

  it('병합이 충돌로 실패해도 목록을 다시 읽는다 — 저장소가 반쯤 바뀐 채로 남는다', async () => {
    api.gitMergeBranch.mockResolvedValue({ ok: false, message: 'CONFLICT (content): …' })
    const refs = mkRefs()
    const { result } = renderHook(() => useGitRefActions('p1', refs, mkToasts()))

    await settle(() => result.current.onMerge('feat'))

    await waitFor(() => expect(refs.reload).toHaveBeenCalled())
  })

  it('프로젝트가 없으면 아무것도 부르지 않는다', async () => {
    const { result } = renderHook(() => useGitRefActions(null, mkRefs(), mkToasts()))

    await settle(() => result.current.onSwitch('main'))

    expect(api.gitSwitchBranch).not.toHaveBeenCalled()
  })
})

describe('useGitRefActions — 임시저장', () => {
  // 🔴 담을 게 없어도 git 은 exit 0 이다 (실측). ok 만 보고 "저장했다" 고 하면 거짓말이다.
  it('실제로 생겼는지는 새 목록으로 판단한다 — 안 생겼으면 그렇게 말한다', async () => {
    const toasts = mkToasts()
    const refs = mkRefs([], { branches: [], stashes: [] })
    const { result } = renderHook(() => useGitRefActions('p1', refs, toasts))

    await settle(() => result.current.onStash('작업 중'))

    expect(api.gitStashPush).toHaveBeenCalledWith({ projectId: 'p1', message: '작업 중' })
    expect(toasts.show).toHaveBeenCalledWith('담아 둘 변경이 없습니다')
  })

  it('새로 생겼으면 저장했다고 말한다', async () => {
    const toasts = mkToasts()
    const refs = mkRefs([], { branches: [], stashes: [stash('stash@{0}')] })
    const { result } = renderHook(() => useGitRefActions('p1', refs, toasts))

    await settle(() => result.current.onStash('작업 중'))

    expect(toasts.show).toHaveBeenCalledWith('임시저장했습니다')
  })

  it('복원은 확인 없이, 버리기는 확인 뒤에 — 서로 다른 채널로 간다', async () => {
    const { result } = renderHook(() => useGitRefActions('p1', mkRefs([stash('stash@{0}')]), mkToasts()))

    await settle(() => result.current.onApplyStash('stash@{0}'))
    expect(api.gitApplyStash).toHaveBeenCalledWith({ projectId: 'p1', ref: 'stash@{0}' })
    expect(window.confirm).not.toHaveBeenCalled()

    await settle(() => result.current.onDropStash('stash@{0}'))
    expect(window.confirm).toHaveBeenCalled()
    expect(api.gitDropStash).toHaveBeenCalledWith({ projectId: 'p1', ref: 'stash@{0}' })
  })

  it('버리기 확인을 취소하면 아무것도 하지 않는다', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const { result } = renderHook(() => useGitRefActions('p1', mkRefs(), mkToasts()))

    await settle(() => result.current.onDropStash('stash@{0}'))

    expect(api.gitDropStash).not.toHaveBeenCalled()
  })
})
