import { useCallback, useEffect, useState } from 'react'
import type { DiffRow } from './diffRows'
import { splitDiffHunks, type DiffHunk } from './diffHunks'
import { rowsFromContent } from './unifiedDiff'
import type { ToastApi } from './useToasts'

// 소스 관리 탭에서 **고른 파일 하나**의 diff.
//
// `useOpenFiles.openDiff` 를 쓰지 않는다 — 그건 **탭을 만드는** 함수라 여기서 부르면
// 탭이 하나 더 생긴다. 탭을 늘리지 않는 것이 이 갈래의 존재 이유다.
//
// 프로젝트·파일·묶음이 바뀌면 **즉시 비운다** (`useGitState` 와 같은 규칙).
// 남겨 두면 새 파일 이름 아래에 앞 파일의 내용이 잠깐 보인다.

interface DiffData {
  hunks: DiffHunk[]
  /** 추적 안 되는 파일 — 비교 대상이 없어 덩어리가 없다. 내용을 통째로 그린다. */
  rows: DiffRow[]
  untracked: boolean
}

const EMPTY: DiffData = { hunks: [], rows: [], untracked: false }

export interface ScmDiffHandle {
  loading: boolean
  /** 못 읽은 사유. 없으면 null */
  error: string | null
  untracked: boolean
  hunks: DiffHunk[]
  /** untracked 일 때만 찬다 (덩어리가 없다) */
  rows: DiffRow[]
  /** 덩어리 하나만 인덱스에 담는다. */
  onStageHunk: (index: number) => void
  /** 덩어리 하나만 워킹트리에서 되돌린다. **되돌릴 수 없어** 한 번 확인받는다. */
  onRevertHunk: (index: number) => void
}

export function useScmDiff(
  projectId: string | null,
  path: string | null,
  staged: boolean,
  toasts: ToastApi,
): ScmDiffHandle {
  const [data, setData] = useState<DiffData>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  // 대상이 바뀌면 앞의 것을 즉시 버린다. nonce(다시 읽기)는 일부러 뺀다 —
  // 덩어리를 담을 때마다 화면이 깜빡 비면 방금 무엇을 눌렀는지 놓친다.
  useEffect(() => {
    setData(EMPTY)
    setError(null)
  }, [projectId, path, staged])

  useEffect(() => {
    if (projectId === null || path === null) return

    // 답이 늦게 온 사이에 다른 파일을 골랐으면 그 답을 버린다
    let alive = true
    setLoading(true)
    void window.davis.gitFileDiff({ projectId, path, staged }).then((result) => {
      if (!alive) return
      setLoading(false)
      if (!result.ok) {
        setData(EMPTY)
        setError(result.reason ?? '변경 내용을 읽지 못했습니다')
        return
      }
      setError(null)
      setData(
        result.untracked === true
          ? { hunks: [], rows: rowsFromContent(result.diff), untracked: true }
          : { hunks: splitDiffHunks(result.diff), rows: [], untracked: false },
      )
    })

    return () => {
      alive = false
    }
  }, [projectId, path, staged, nonce])

  const apply = useCallback(
    (index: number, revert: boolean) => {
      if (projectId === null || path === null) return
      const hunk = data.hunks[index]
      if (hunk === undefined) return

      // ⚠ `hunkText` 는 **화면이 그린 덩어리 원문 그대로** 나간다. trim·재조립하면
      //   main 이 매번 거절한다 (`diffHunks.ts` 머리말 · `shared/git/hunkSplit.ts`).
      //   머리 한 줄이 아니라 본문까지 보내는 이유는, 화면이 그린 뒤 클릭 전에 그
      //   덩어리가 **같은 줄 수로** 바뀌면 머리만으로는 못 잡기 때문이다 (QA D4).
      const payload = { projectId, path, hunkIndex: index, hunkText: hunk.text }
      const call = revert
        ? window.davis.gitRevertHunk(payload)
        : window.davis.gitStageHunk(payload)

      void call.then((result) => {
        if (!result.ok) {
          toasts.show(result.message ?? (revert ? '되돌리지 못했습니다' : '담지 못했습니다'), 'error')
        }
        // 성공·실패를 가리지 않고 다시 읽는다. **담으면 그 덩어리가 diff 에서 빠져
        // 뒤 인덱스가 밀린다** — 옛 목록으로 다음 덩어리를 누르면 헤더 대조에 걸려
        // 거절되고, 사용자에게는 "새로 고치라"는 문구만 보인다.
        setNonce((value) => value + 1)
      })
    },
    [projectId, path, data.hunks, toasts],
  )

  const onStageHunk = useCallback((index: number) => apply(index, false), [apply])

  const onRevertHunk = useCallback(
    (index: number) => {
      // 파일 되돌리기(`useGitActions`)와 같은 결 — 되돌릴 수 없어 한 번 묻는다.
      if (!window.confirm('이 덩어리의 변경을 되돌릴까요? 되돌릴 수 없습니다.')) return
      apply(index, true)
    },
    [apply],
  )

  return {
    loading,
    error,
    untracked: data.untracked,
    hunks: data.hunks,
    rows: data.rows,
    onStageHunk,
    onRevertHunk,
  }
}
