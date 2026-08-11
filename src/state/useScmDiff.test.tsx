// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useScmDiff } from './useScmDiff'
import type { ToastApi } from './useToasts'
import type { GitActionResult, GitDiffResultPayload } from '../../shared/ipc/gitPayloads'

// 탭 안 diff 의 계약 3가지를 잠근다.
//  1. **덩어리 원문(머리+본문)** 을 그대로 보낸다 (되만들면 main 이 매번 거절한다)
//  2. 담은 **직후 다시 읽는다** (안 읽으면 다음 요청이 밀린 인덱스로 가 거절된다)
//  3. 되돌리기는 확인을 받는다

const DIFF = [
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,3 +1,3 @@ head one',
  ' keep',
  '-old',
  '+new',
  '@@ -20,3 +20,4 @@ head two',
  ' keep2',
  '+added',
  '',
].join('\n')

const gitFileDiff = vi.fn<() => Promise<GitDiffResultPayload>>()
const gitStageHunk = vi.fn<() => Promise<GitActionResult>>()
const gitRevertHunk = vi.fn<() => Promise<GitActionResult>>()

function mkToasts(): ToastApi {
  return { toasts: [], show: vi.fn(), dismiss: vi.fn() }
}

async function settle(cb: () => void) {
  await act(async () => {
    cb()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  gitFileDiff.mockReset().mockResolvedValue({ ok: true, diff: DIFF })
  gitStageHunk.mockReset().mockResolvedValue({ ok: true })
  gitRevertHunk.mockReset().mockResolvedValue({ ok: true })
  ;(window as unknown as { davis: unknown }).davis = { gitFileDiff, gitStageHunk, gitRevertHunk }
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('useScmDiff — 읽기', () => {
  it('고른 파일과 묶음을 겉봉에 실어 묻는다', async () => {
    renderHook(() => useScmDiff('p1', 'a.ts', false, mkToasts()))

    await waitFor(() =>
      expect(gitFileDiff).toHaveBeenCalledWith({ projectId: 'p1', path: 'a.ts', staged: false }),
    )
  })

  it('고른 파일이 없으면 아예 묻지 않는다', async () => {
    renderHook(() => useScmDiff('p1', null, false, mkToasts()))

    await act(async () => await Promise.resolve())
    expect(gitFileDiff).not.toHaveBeenCalled()
  })

  it('덩어리로 갈라 낸다', async () => {
    const { result } = renderHook(() => useScmDiff('p1', 'a.ts', false, mkToasts()))

    await waitFor(() => expect(result.current.hunks).toHaveLength(2))
    expect(result.current.hunks.map((hunk) => hunk.header)).toEqual([
      '@@ -1,3 +1,3 @@ head one',
      '@@ -20,3 +20,4 @@ head two',
    ])
  })

  it('추적 안 되는 파일은 덩어리 없이 내용을 통째로 준다', async () => {
    gitFileDiff.mockResolvedValue({ ok: true, diff: 'a\nb', untracked: true })
    const { result } = renderHook(() => useScmDiff('p1', 'new.ts', false, mkToasts()))

    await waitFor(() => expect(result.current.untracked).toBe(true))
    expect(result.current.hunks).toEqual([])
    expect(result.current.rows.map((row) => row.text)).toEqual(['a', 'b'])
  })

  it('실패하면 사유를 남기고 덩어리를 비운다', async () => {
    gitFileDiff.mockResolvedValue({ ok: false, diff: '', reason: '너무 큽니다' })
    const { result } = renderHook(() => useScmDiff('p1', 'a.ts', false, mkToasts()))

    await waitFor(() => expect(result.current.error).toBe('너무 큽니다'))
    expect(result.current.hunks).toEqual([])
  })

  // 사유 없이 실패하는 경로가 있다. 그때 error 가 null 로 남으면 화면은 "변경 없음" 과
  // 구별이 안 된다 — 읽지 못한 것과 바뀐 게 없는 것은 다른 사실이다.
  it('사유가 비어 있어도 못 읽었다는 것은 말한다', async () => {
    gitFileDiff.mockResolvedValue({ ok: false, diff: '' })
    const { result } = renderHook(() => useScmDiff('p1', 'a.ts', false, mkToasts()))

    await waitFor(() => expect(result.current.error).toBe('변경 내용을 읽지 못했습니다'))
  })

  // 🔴 파일을 빠르게 두 번 고르면 앞 파일의 답이 뒤에 도착한다. 그걸 얹으면
  //    **새 파일 이름 아래에 앞 파일의 덩어리**가 그려진다 (머리말의 "즉시 비운다" 와 짝).
  it('늦게 온 앞 파일의 답은 얹지 않는다', async () => {
    const ONE_HUNK = ['@@ -1,2 +1,2 @@ b 파일', ' keep', '+add', ''].join('\n')
    let resolveA!: (v: GitDiffResultPayload) => void
    gitFileDiff.mockImplementationOnce(() => new Promise((r) => (resolveA = r)))

    const { result, rerender } = renderHook(({ path }) => useScmDiff('p1', path, false, mkToasts()), {
      initialProps: { path: 'a.ts' as string | null },
    })

    gitFileDiff.mockResolvedValue({ ok: true, diff: ONE_HUNK })
    rerender({ path: 'b.ts' })
    await waitFor(() => expect(result.current.hunks).toHaveLength(1))

    await act(async () => {
      resolveA({ ok: true, diff: DIFF })
      await Promise.resolve()
    })
    // a.ts 의 덩어리 둘이 b.ts 화면을 덮지 않는다
    expect(result.current.hunks).toHaveLength(1)
    expect(result.current.hunks[0]?.header).toBe('@@ -1,2 +1,2 @@ b 파일')
  })
})

describe('useScmDiff — 덩어리 담기', () => {
  // 머리 한 줄만 보내면 **제자리 내용 변경**을 main 이 못 잡는다 (QA D4). 본문까지
  // 원문 그대로 실려야 하고, 끝에 개행이 붙어서도 안 된다 (main 이 안 붙인다).
  it('덩어리 원문을 머리+본문 그대로 보낸다 — 되만든 문자열이 아니다', async () => {
    const { result } = renderHook(() => useScmDiff('p1', 'a.ts', false, mkToasts()))
    await waitFor(() => expect(result.current.hunks).toHaveLength(2))

    await settle(() => result.current.onStageHunk(1))

    expect(gitStageHunk).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'a.ts',
      hunkIndex: 1,
      hunkText: '@@ -20,3 +20,4 @@ head two\n keep2\n+added',
    })
  })

  // 🔴 이것이 빠지면 두 번째 덩어리 클릭이 **항상** 거절된다 (인덱스가 밀린 채로 간다).
  //
  // ⚠ 기다리는 것은 **호출 수가 아니라 덩어리가 찼는지**다 (QA F1). 호출 수만 보면
  //    `.then()` 의 `setData` 가 아직 안 돈 채로 진행돼 `hunks` 가 비고, `apply` 의
  //    `if (hunk === undefined) return` 이 조용히 아무 일도 안 해 부하가 걸린 워커에서
  //    산발 실패했다. 화면이 실제로 쓰는 상태를 기다린다 (이 파일의 다른 케이스와 같게).
  it('담은 직후 diff 를 다시 읽는다', async () => {
    const { result } = renderHook(() => useScmDiff('p1', 'a.ts', false, mkToasts()))
    await waitFor(() => expect(result.current.hunks).toHaveLength(2))
    expect(gitFileDiff).toHaveBeenCalledTimes(1)

    await settle(() => result.current.onStageHunk(0))

    await waitFor(() => expect(gitFileDiff).toHaveBeenCalledTimes(2))
  })

  it('실패해도 다시 읽고, git 문구를 그대로 알린다', async () => {
    gitStageHunk.mockResolvedValue({ ok: false, message: '그 사이 파일이 바뀌어…' })
    const toasts = mkToasts()
    const { result } = renderHook(() => useScmDiff('p1', 'a.ts', false, toasts))
    await waitFor(() => expect(result.current.hunks).toHaveLength(2))

    await settle(() => result.current.onStageHunk(0))

    expect(toasts.show).toHaveBeenCalledWith('그 사이 파일이 바뀌어…', 'error')
    await waitFor(() => expect(gitFileDiff).toHaveBeenCalledTimes(2))
  })

  // git 이 사유 없이 거절할 때 "담지 못했습니다" 조차 안 뜨면 사용자는 눌렀는데
  // 아무 일도 안 일어난 것으로 본다 (다시 읽기 때문에 화면은 그대로다).
  it('사유가 비어 있어도 어느 행동이 실패했는지는 말한다', async () => {
    gitStageHunk.mockResolvedValue({ ok: false })
    gitRevertHunk.mockResolvedValue({ ok: false })
    const toasts = mkToasts()
    const { result } = renderHook(() => useScmDiff('p1', 'a.ts', false, toasts))
    await waitFor(() => expect(result.current.hunks).toHaveLength(2))

    await settle(() => result.current.onStageHunk(0))
    expect(toasts.show).toHaveBeenCalledWith('담지 못했습니다', 'error')

    await waitFor(() => expect(result.current.hunks).toHaveLength(2))
    await settle(() => result.current.onRevertHunk(0))
    expect(toasts.show).toHaveBeenCalledWith('되돌리지 못했습니다', 'error')
  })

  it('프로젝트가 없으면 덩어리 행동을 하지 않는다', async () => {
    const { result } = renderHook(() => useScmDiff(null, 'a.ts', false, mkToasts()))

    await settle(() => result.current.onStageHunk(0))

    expect(gitStageHunk).not.toHaveBeenCalled()
  })

  it('없는 덩어리를 가리키면 아예 부르지 않는다', async () => {
    const { result } = renderHook(() => useScmDiff('p1', 'a.ts', false, mkToasts()))
    await waitFor(() => expect(result.current.hunks).toHaveLength(2))

    await settle(() => result.current.onStageHunk(9))

    expect(gitStageHunk).not.toHaveBeenCalled()
  })
})

describe('useScmDiff — 덩어리 되돌리기', () => {
  it('확인을 받고 나서야 부른다', async () => {
    const { result } = renderHook(() => useScmDiff('p1', 'a.ts', false, mkToasts()))
    await waitFor(() => expect(result.current.hunks).toHaveLength(2))

    await settle(() => result.current.onRevertHunk(0))

    expect(window.confirm).toHaveBeenCalled()
    expect(gitRevertHunk).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'a.ts',
      hunkIndex: 0,
      hunkText: '@@ -1,3 +1,3 @@ head one\n keep\n-old\n+new',
    })
  })

  it('확인을 취소하면 아무것도 하지 않는다', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const { result } = renderHook(() => useScmDiff('p1', 'a.ts', false, mkToasts()))
    await waitFor(() => expect(result.current.hunks).toHaveLength(2))

    await settle(() => result.current.onRevertHunk(0))

    expect(gitRevertHunk).not.toHaveBeenCalled()
    expect(gitFileDiff).toHaveBeenCalledTimes(1)
  })
})
