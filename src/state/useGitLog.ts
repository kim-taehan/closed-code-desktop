import { useCallback, useEffect, useState } from 'react'
import type { GitCommitDetail, GitCommitSummary } from '../../shared/git/gitCommit'

// 커밋 조회 두 갈래 — 목록(페이징)과 상세.
//
// 둘 다 **요청-응답**이다. `GitState` 처럼 밀려오지 않는다 (`gitHistoryBridge.ts` 머리말).
// 그래서 프로젝트가 바뀌면 여기서 직접 비우고 다시 묻는다 (`useGitState`·`useScmDiff` 와 같은 규칙).
//
// 쪽 크기는 화면이 정하지 않는다 — main 의 `COMMIT_PAGE_SIZE` 하나뿐이고, 겉봉에는
// "어디서부터"(`skip`)만 싣는다 (`gitPayloads.GitLogPayload` 주석).

export interface GitLogHandle {
  commits: GitCommitSummary[]
  loading: boolean
  /** 못 읽은 사유 — git 이 낸 원문. 없으면 null */
  error: string | null
  /** 다음 쪽이 있는가. 「더 보기」를 그릴지가 여기서 갈린다. */
  hasMore: boolean
  loadMore: () => void
}

/** 지금 무엇을 묻고 있는가. 프로젝트와 쪽을 **한 덩어리로** 쥔다 — 아래 이유 참고. */
interface LogCursor {
  id: string | null
  skip: number
}

export function useGitLog(projectId: string | null): GitLogHandle {
  const [commits, setCommits] = useState<GitCommitSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<LogCursor>({ id: projectId, skip: 0 })

  useEffect(() => {
    // ⚠ 프로젝트가 막 바뀐 렌더에서는 `cursor` 가 아직 **앞 저장소의 쪽**이다.
    //   그대로 물으면 새 저장소의 5쪽째를 첫 화면으로 그리게 된다. 먼저 되돌리고
    //   **묻지 않은 채** 물러난다 — 커서가 바뀌면 이 효과가 다시 돈다.
    //
    //   되돌리기를 별도 효과로 두면 첫 렌더에서 커서 객체만 새로 만들어져 같은 쪽을
    //   두 번 묻는다. 그래서 한 효과 안에 둔다.
    if (cursor.id !== projectId) {
      setCommits([])
      setHasMore(false)
      setError(null)
      setCursor({ id: projectId, skip: 0 })
      return
    }
    if (cursor.id === null) return

    // 답이 늦게 온 사이에 다른 것을 물었으면 그 답을 버린다 (`useScmDiff` 와 같은 결)
    let alive = true
    setLoading(true)
    void window.davis.gitLog({ projectId: cursor.id, skip: cursor.skip }).then((result) => {
      if (!alive) return
      setLoading(false)
      if (!result.ok) {
        setError(result.message ?? '커밋을 읽지 못했습니다')
        return
      }
      setError(null)
      setHasMore(result.hasMore)
      // ⚠ 커밋이 하나도 없는 저장소는 **실패가 아니라** 빈 목록이다
      //   (`gitHistoryBridge.gitLog` 주석). 빈 상태 문구는 화면이 낸다.
      setCommits((prev) => (cursor.skip === 0 ? result.commits : [...prev, ...result.commits]))
    })

    return () => {
      alive = false
    }
  }, [projectId, cursor])

  const loadMore = useCallback(() => {
    // 이미 읽은 만큼 건너뛴다. 쪽 번호가 아니라 개수라 중간에 커밋이 들어와도
    // 같은 것을 두 번 붙이지 않는다.
    if (!hasMore || loading) return
    setCursor((prev) => ({ id: prev.id, skip: commits.length }))
  }, [hasMore, loading, commits.length])

  return { commits, loading, error, hasMore, loadMore }
}

export interface GitCommitDetailHandle {
  detail: GitCommitDetail | null
  loading: boolean
  error: string | null
}

/** 커밋 하나의 요약 + 파일 목록 + diff. `hash` 는 `GitCommitSummary.hash`. */
export function useGitCommitDetail(
  projectId: string | null,
  hash: string | null,
): GitCommitDetailHandle {
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 고른 커밋이 바뀌면 즉시 비운다 — 남겨 두면 새 제목 아래 앞 커밋의 diff 가 잠깐 보인다.
  useEffect(() => {
    setDetail(null)
    setError(null)
  }, [projectId, hash])

  useEffect(() => {
    if (projectId === null || hash === null) return

    let alive = true
    setLoading(true)
    void window.davis.gitCommitDetail({ projectId, ref: hash }).then((result) => {
      if (!alive) return
      setLoading(false)
      if (!result.ok || result.detail === undefined) {
        setError(result.message ?? '커밋을 읽지 못했습니다')
        return
      }
      setError(null)
      setDetail(result.detail)
    })

    return () => {
      alive = false
    }
  }, [projectId, hash])

  return { detail, loading, error }
}
