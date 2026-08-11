import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitBranchEntry, GitStashEntry } from '../../shared/git/gitRefs'

// 브랜치·임시저장 목록.
//
// 둘을 한 훅에 둔 이유는 `shared/git/gitRefs.ts` 가 둘을 한 파일에 둔 것과 같다 —
// 성격(참조 목록)도 같고, **다시 읽는 시점도 같다.** 행동 하나가 둘 다 흔든다:
// 임시저장 복원은 작업트리를, 브랜치 전환은 임시저장이 걸린 자리를 바꾼다.
//
// ⚠ **이 목록은 밀려오지 않는다.** 저장소를 바꾸는 행동 뒤에 `git:statePush` 로 오는 것은
// `GitState`(브랜치 이름·변경 파일)뿐이다. 브랜치·임시저장 목록은 요청-응답이라
// 행동한 쪽이 `reload()` 를 불러야 화면이 사실과 맞는다 (`useGitRefActions` 가 그렇게 한다).

export interface GitRefsData {
  branches: GitBranchEntry[]
  stashes: GitStashEntry[]
}

const EMPTY: GitRefsData = { branches: [], stashes: [] }

export interface GitRefsHandle extends GitRefsData {
  loading: boolean
  /** 못 읽은 사유 — git 원문. 없으면 null */
  error: string | null
  /**
   * 다시 읽고 **읽은 것을 돌려준다.**
   *
   * 돌려주는 이유는 `gitStashPush` 때문이다 — 담을 게 없어도 `ok:true` 로 와서
   * (`gitHistoryBridge` 주석) 실제로 생겼는지는 **새 목록**으로만 판단할 수 있다.
   */
  reload: () => Promise<GitRefsData>
}

export function useGitRefs(projectId: string | null): GitRefsHandle {
  const [data, setData] = useState<GitRefsData>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 답이 늦게 온 사이에 다른 저장소를 물었으면 그 답을 화면에 얹지 않는다
  const seq = useRef(0)

  const reload = useCallback(async (): Promise<GitRefsData> => {
    if (projectId === null) return EMPTY

    const mine = (seq.current += 1)
    setLoading(true)
    const [branches, stashes] = await Promise.all([
      window.davis.gitBranches({ projectId }),
      window.davis.gitStashes({ projectId }),
    ])
    const next: GitRefsData = { branches: branches.branches, stashes: stashes.stashes }
    if (seq.current !== mine) return next

    setLoading(false)
    // 둘 중 하나만 실패해도 그 사유를 보인다 — 브랜치가 먼저다 (화면의 주인공)
    setError(
      !branches.ok
        ? (branches.message ?? '브랜치를 읽지 못했습니다')
        : !stashes.ok
          ? (stashes.message ?? '임시저장을 읽지 못했습니다')
          : null,
    )
    setData(next)
    return next
  }, [projectId])

  // 프로젝트가 바뀌면 앞 저장소의 목록을 즉시 버린다 (`useGitState` 와 같은 규칙)
  useEffect(() => {
    setData(EMPTY)
    setError(null)
    void reload()
  }, [reload])

  return { ...data, loading, error, reload }
}
