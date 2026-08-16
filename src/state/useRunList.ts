import { useCallback, useEffect, useState } from 'react'
import type { RunEntry } from '../../shared/run/runList'

// 실행 목록을 **앱 저장소에서 읽는다** (설계 §2).
//
// ⚠️ 여기에는 **"AGENTS.md 에서 읽는다 — 파일이 곧 캐시다"** 라고 적혀 있었고, 읽는 것도
// 렌더러였다(`readFile` 로 프로젝트 파일을 직접 읽었다). 목록이 앱 저장소로 옮겨 가며
// 둘 다 거짓이 됐다 — 이유와 그때 잃은 것은 `shared/run/runList.ts` 머리말에 있다.
//
// **읽는 것은 이제 main 이다.** 목록이 프로젝트 밖이라 `readFile` 이 못 닿는다
// (`RUN_LIST_READ`). 「다시 확인할까요?」 판정도 main 이 함께 실어 보낸다 — 지문을 재는 곳이
// 둘이면 값이 갈리고, 그러면 사용자는 무엇을 해도 사라지지 않는 물음을 보게 된다.
// 그래서 이 훅에 남은 것은 **언제 다시 묻나**(프로젝트 전환 · ↻ · 모델이 적었다는 신호)뿐이다.

export interface RunListHandle {
  entries: RunEntry[]
  /**
   * 목록이 **있었나.** 없는 것과 비어 있는 것은 다른 사실이라 가른다 —
   * 앞은 아직 안 물어본 것이고, 뒤는 물어봤는데 못 찾은 것이다 (`runSourceLine`).
   */
  found: boolean
  /**
   * 매니페스트가 목록을 적을 때와 **다르다.** 화면이 "다시 확인할까요?" 를 띄운다.
   *
   * ⚠️ **말없이 다시 분석하지 않는다** (설계 §2) — 20초를 사용자 모르게 태우지 않는다.
   * 그래서 이 값은 화면에 물음을 띄울 뿐 아무것도 부르지 않는다.
   */
  stale: boolean
  loading: boolean
  /** ↻ · 모델이 방금 적었다는 신호(`onRunListChanged`)가 오면 다시 읽는다 */
  refresh: () => void
}

export function useRunList(projectId: string): RunListHandle {
  const [state, setState] = useState<{ entries: RunEntry[]; found: boolean; stale: boolean }>({
    entries: [],
    found: false,
    stale: false,
  })
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    // 프로젝트를 옮기는 순간 앞 프로젝트의 목록이 남아 있으면, 사용자는 **남의 프로젝트
    // 명령을 이 프로젝트에서 띄우게 된다.** 읽어 오는 동안 비워 둔다.
    let alive = true
    setLoading(true)
    setState({ entries: [], found: false, stale: false })

    void window.davis.readRunList({ projectId }).then((next) => {
      if (alive) {
        setState({ entries: next.entries, found: next.found, stale: next.stale })
        setLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [projectId, nonce])

  // 모델이 `save_run_commands` 로 방금 적었다 — **목록은 안 실려 온다.** 정본은 저장소이고
  // 이 신호는 "다시 읽어라" 하나다 (`RUN_LIST_CHANGED`).
  useEffect(
    () => window.davis.onRunListChanged((_payload, from) => (from === projectId ? refresh() : undefined)),
    [projectId, refresh],
  )

  return { ...state, loading, refresh }
}
