// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitCommitDetail, useGitLog } from './useGitLog'
import type { GitCommitDetailResult, GitCommitSummary, GitLogResult } from '../../shared/git/gitCommit'

// 커밋 조회의 계약 3가지를 잠근다.
//  1. 「더 보기」는 **읽은 개수**만큼 건너뛴다 (쪽 번호가 아니다)
//  2. 커밋 0개는 오류가 아니다
//  3. 프로젝트가 바뀌면 앞 저장소의 쪽을 이어 붙이지 않는다

const gitLog = vi.fn<() => Promise<GitLogResult>>()
const gitCommitDetail = vi.fn<() => Promise<GitCommitDetailResult>>()

function commit(hash: string): GitCommitSummary {
  return { hash, shortHash: hash.slice(0, 7), author: '김태한', date: '', refs: [], subject: hash }
}

beforeEach(() => {
  gitLog.mockReset().mockResolvedValue({ ok: true, commits: [commit('a')], hasMore: false })
  gitCommitDetail.mockReset()
  ;(window as unknown as { davis: unknown }).davis = { gitLog, gitCommitDetail }
})

describe('useGitLog — 첫 쪽', () => {
  it('프로젝트를 겉봉에 싣고 첫 쪽부터 묻는다', async () => {
    renderHook(() => useGitLog('p1'))

    await waitFor(() => expect(gitLog).toHaveBeenCalledWith({ projectId: 'p1', skip: 0 }))
  })

  it('프로젝트가 없으면 아예 묻지 않는다', async () => {
    renderHook(() => useGitLog(null))

    await act(async () => await Promise.resolve())
    expect(gitLog).not.toHaveBeenCalled()
  })

  // 🔴 이것이 오류로 새면 갓 만든 저장소가 빨간 문구로 맞이한다
  it('커밋이 하나도 없어도 오류가 아니다 — 빈 목록이다', async () => {
    gitLog.mockResolvedValue({ ok: true, commits: [], hasMore: false })
    const { result } = renderHook(() => useGitLog('p1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.commits).toEqual([])
  })

  it('실패하면 git 문구를 그대로 남긴다', async () => {
    gitLog.mockResolvedValue({ ok: false, commits: [], hasMore: false, message: 'not a git repo' })
    const { result } = renderHook(() => useGitLog('p1'))

    await waitFor(() => expect(result.current.error).toBe('not a git repo'))
  })

  // 🔴 늦게 온 앞 저장소의 쪽을 얹으면 새 저장소의 히스토리에 남의 커밋이 섞인다
  it('늦게 온 앞 저장소의 답은 얹지 않는다', async () => {
    let resolveP1!: (v: GitLogResult) => void
    gitLog.mockImplementationOnce(() => new Promise((r) => (resolveP1 = r)))
    const { result, rerender } = renderHook(({ id }) => useGitLog(id), {
      initialProps: { id: 'p1' as string | null },
    })

    gitLog.mockResolvedValue({ ok: true, commits: [commit('p2-커밋')], hasMore: false })
    rerender({ id: 'p2' })
    await waitFor(() => expect(result.current.commits.map((c) => c.hash)).toEqual(['p2-커밋']))

    await act(async () => {
      resolveP1({ ok: true, commits: [commit('p1-지각')], hasMore: true })
      await Promise.resolve()
    })
    expect(result.current.commits.map((c) => c.hash)).toEqual(['p2-커밋'])
  })
})

describe('useGitLog — 더 보기', () => {
  it('읽은 **개수**만큼 건너뛰고 뒤에 이어 붙인다', async () => {
    gitLog.mockResolvedValue({
      ok: true,
      commits: [commit('a'), commit('b')],
      hasMore: true,
    })
    const { result } = renderHook(() => useGitLog('p1'))
    await waitFor(() => expect(result.current.commits).toHaveLength(2))

    gitLog.mockResolvedValue({ ok: true, commits: [commit('c')], hasMore: false })
    await act(async () => {
      result.current.loadMore()
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.commits).toHaveLength(3))
    expect(gitLog).toHaveBeenLastCalledWith({ projectId: 'p1', skip: 2 })
    expect(result.current.commits.map((entry) => entry.hash)).toEqual(['a', 'b', 'c'])
    expect(result.current.hasMore).toBe(false)
  })

  it('다음 쪽이 없으면 더 묻지 않는다', async () => {
    const { result } = renderHook(() => useGitLog('p1'))
    await waitFor(() => expect(gitLog).toHaveBeenCalledTimes(1))

    await act(async () => {
      result.current.loadMore()
      await Promise.resolve()
    })

    expect(gitLog).toHaveBeenCalledTimes(1)
  })

  // 🔴 커서를 프로젝트와 함께 쥐지 않으면 새 저장소의 **3쪽째**가 첫 화면이 된다
  it('프로젝트가 바뀌면 앞 저장소의 쪽을 이어 가지 않는다', async () => {
    gitLog.mockResolvedValue({ ok: true, commits: [commit('a'), commit('b')], hasMore: true })
    const { result, rerender } = renderHook(({ id }) => useGitLog(id), {
      initialProps: { id: 'p1' },
    })
    await waitFor(() => expect(result.current.commits).toHaveLength(2))
    await act(async () => {
      result.current.loadMore()
      await Promise.resolve()
    })
    await waitFor(() => expect(gitLog).toHaveBeenLastCalledWith({ projectId: 'p1', skip: 2 }))

    gitLog.mockResolvedValue({ ok: true, commits: [commit('z')], hasMore: false })
    rerender({ id: 'p2' })

    await waitFor(() => expect(gitLog).toHaveBeenLastCalledWith({ projectId: 'p2', skip: 0 }))
    expect(gitLog).not.toHaveBeenCalledWith({ projectId: 'p2', skip: 2 })
    await waitFor(() => expect(result.current.commits.map((c) => c.hash)).toEqual(['z']))
  })
})

describe('useGitCommitDetail', () => {
  it('고른 커밋 해시를 ref 로 묻는다', async () => {
    gitCommitDetail.mockResolvedValue({
      ok: true,
      detail: { commit: commit('abc'), files: [], diff: '', truncated: false },
    })
    const { result } = renderHook(() => useGitCommitDetail('p1', 'abc'))

    await waitFor(() => expect(gitCommitDetail).toHaveBeenCalledWith({ projectId: 'p1', ref: 'abc' }))
    await waitFor(() => expect(result.current.detail?.commit.hash).toBe('abc'))
  })

  it('고른 커밋이 없으면 묻지 않는다', async () => {
    renderHook(() => useGitCommitDetail('p1', null))

    await act(async () => await Promise.resolve())
    expect(gitCommitDetail).not.toHaveBeenCalled()
  })

  // 🔴 앞 커밋의 늦은 상세를 얹으면 **새 커밋 제목 아래 앞 커밋의 diff** 가 그려진다
  //    (머리말의 "고른 커밋이 바뀌면 즉시 비운다" 와 짝)
  it('앞 커밋의 늦게 온 상세는 얹지 않는다', async () => {
    let resolveOld!: (v: GitCommitDetailResult) => void
    gitCommitDetail.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
    const { result, rerender } = renderHook(({ hash }) => useGitCommitDetail('p1', hash), {
      initialProps: { hash: 'old' as string | null },
    })

    gitCommitDetail.mockResolvedValue({
      ok: true,
      detail: { commit: commit('new'), files: [], diff: '', truncated: false },
    })
    rerender({ hash: 'new' })
    await waitFor(() => expect(result.current.detail?.commit.hash).toBe('new'))

    await act(async () => {
      resolveOld({
        ok: true,
        detail: { commit: commit('old'), files: [], diff: '지각 diff', truncated: false },
      })
      await Promise.resolve()
    })
    expect(result.current.detail?.commit.hash).toBe('new')
  })

  it('ok 인데 알맹이가 없으면 오류로 본다 — 빈 상세를 그리지 않는다', async () => {
    gitCommitDetail.mockResolvedValue({ ok: true, message: undefined })
    const { result } = renderHook(() => useGitCommitDetail('p1', 'abc'))

    await waitFor(() => expect(result.current.error).toBe('커밋을 읽지 못했습니다'))
    expect(result.current.detail).toBeNull()
  })
})
