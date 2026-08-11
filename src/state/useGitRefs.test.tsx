// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitRefs } from './useGitRefs'

// 목록 조회가 잠그는 것.
//  1. `reload()` 는 **읽은 것을 돌려준다** (임시저장이 실제로 생겼는지 판단하는 근거)
//  2. 한쪽만 실패해도 그 사유를 보인다
//  3. 프로젝트가 바뀌면 앞 저장소의 목록을 이어 그리지 않는다

const gitBranches = vi.fn()
const gitStashes = vi.fn()

const BRANCH = { name: 'main', remote: false, date: '', track: '', current: true }
const STASH = { ref: 'stash@{0}', date: '', label: 'On main: WIP' }

beforeEach(() => {
  gitBranches.mockReset().mockResolvedValue({ ok: true, branches: [BRANCH] })
  gitStashes.mockReset().mockResolvedValue({ ok: true, stashes: [STASH] })
  ;(window as unknown as { davis: unknown }).davis = { gitBranches, gitStashes }
})

describe('useGitRefs', () => {
  it('브랜치와 임시저장을 함께 읽는다', async () => {
    const { result } = renderHook(() => useGitRefs('p1'))

    await waitFor(() => expect(result.current.branches).toEqual([BRANCH]))
    expect(result.current.stashes).toEqual([STASH])
    expect(gitBranches).toHaveBeenCalledWith({ projectId: 'p1' })
    expect(gitStashes).toHaveBeenCalledWith({ projectId: 'p1' })
  })

  it('프로젝트가 없으면 아예 묻지 않는다', async () => {
    renderHook(() => useGitRefs(null))

    await act(async () => await Promise.resolve())
    expect(gitBranches).not.toHaveBeenCalled()
  })

  // 🔴 돌려주지 않으면 임시저장이 실제로 생겼는지 판단할 방법이 없다 (ok:true 는 못 믿는다)
  it('reload 는 방금 읽은 것을 돌려준다', async () => {
    const { result } = renderHook(() => useGitRefs('p1'))
    await waitFor(() => expect(result.current.branches).toHaveLength(1))

    gitStashes.mockResolvedValue({ ok: true, stashes: [STASH, { ...STASH, ref: 'stash@{1}' }] })
    const next = await act(async () => await result.current.reload())

    expect(next.stashes).toHaveLength(2)
  })

  it('브랜치를 못 읽으면 그 문구를, 임시저장만 못 읽으면 그 문구를 낸다', async () => {
    gitStashes.mockResolvedValue({ ok: false, stashes: [], message: 'stash 실패' })
    const { result, rerender } = renderHook(({ id }) => useGitRefs(id), {
      initialProps: { id: 'p1' },
    })
    await waitFor(() => expect(result.current.error).toBe('stash 실패'))

    // 둘 다 실패하면 브랜치가 먼저다 — 화면의 주인공이라
    gitBranches.mockResolvedValue({ ok: false, branches: [], message: 'branch 실패' })
    rerender({ id: 'p2' })

    await waitFor(() => expect(result.current.error).toBe('branch 실패'))
  })

  // git 이 사유 없이 실패하는 일이 있다 (exit 코드만 오는 경우). 문구가 없다고
  // 조용히 빈 목록만 보이면 "브랜치가 하나도 없는 저장소" 와 구별이 안 된다.
  it('실패 사유가 비어 있어도 못 읽었다는 것은 말한다', async () => {
    gitBranches.mockResolvedValue({ ok: false, branches: [] })
    const { result, rerender } = renderHook(({ id }) => useGitRefs(id), {
      initialProps: { id: 'p1' },
    })
    await waitFor(() => expect(result.current.error).toBe('브랜치를 읽지 못했습니다'))

    gitBranches.mockResolvedValue({ ok: true, branches: [BRANCH] })
    gitStashes.mockResolvedValue({ ok: false, stashes: [] })
    rerender({ id: 'p2' })

    await waitFor(() => expect(result.current.error).toBe('임시저장을 읽지 못했습니다'))
  })

  // 🔴 늦게 온 앞 저장소의 답을 얹으면 화면이 남의 브랜치 목록으로 되돌아간다
  it('늦게 온 앞 저장소의 답은 화면에 얹지 않는다', async () => {
    let resolveP1!: (v: { ok: boolean; branches: typeof BRANCH[] }) => void
    gitBranches.mockImplementationOnce(() => new Promise((r) => (resolveP1 = r)))
    const { result, rerender } = renderHook(({ id }) => useGitRefs(id), {
      initialProps: { id: 'p1' },
    })

    const P2 = { ...BRANCH, name: 'p2-branch' }
    gitBranches.mockResolvedValue({ ok: true, branches: [P2] })
    rerender({ id: 'p2' })
    await waitFor(() => expect(result.current.branches).toEqual([P2]))

    // 이제서야 p1 의 답이 도착한다 — seq 가 밀렸으므로 버린다
    await act(async () => {
      resolveP1({ ok: true, branches: [{ ...BRANCH, name: 'p1-지각' }] })
      await Promise.resolve()
    })
    expect(result.current.branches).toEqual([P2])
  })

  it('프로젝트가 바뀌면 앞 저장소의 목록을 비우고 다시 읽는다', async () => {
    const { result, rerender } = renderHook(({ id }) => useGitRefs(id), {
      initialProps: { id: 'p1' },
    })
    await waitFor(() => expect(result.current.branches).toHaveLength(1))

    gitBranches.mockResolvedValue({ ok: true, branches: [] })
    rerender({ id: 'p2' })

    await waitFor(() => expect(result.current.branches).toEqual([]))
    expect(gitBranches).toHaveBeenLastCalledWith({ projectId: 'p2' })
  })
})
