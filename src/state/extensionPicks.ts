import { useCallback, useEffect, useMemo, useState } from 'react'
import { prunedSelection, type TreeNode } from './extensionTree'

// 확장 패널에서 **여러 트리에 걸쳐 고른 것**을 쥔다.
//
// 뷰가 패널 안의 탭이 되면서 트리가 둘 이상일 수 있게 됐다 (화면 탭 · API 탭).
// 고른 것을 탭마다 따로 두되 **명령에는 합쳐서 실어 보낸다** — 프론트 화면 둘과
// 백엔드 API 하나를 골라 한 번에 시나리오를 쓰는 것이 이 확장의 본래 용법이라,
// 탭을 옮길 때 앞 탭의 선택이 풀리면 두 번 나눠 돌려야 한다.
//
// 고른 것을 트리 컴포넌트 안에 두지 않는 이유는 그대로다: 목록이 다시 오면 풀리고,
// 명령 버튼(위쪽 줄)이 무엇을 실어 보낼지 못 본다.
//
// **프로젝트로 한 번 더 가른다.** 안 가르면 다른 프로젝트에 다녀오는 것만으로 선택이
// 사라진다 — 저쪽에서 같은 뷰를 한 번이라도 돌렸으면 아래 걸러내기가 저쪽 트리를 기준으로
// 돌아, 이쪽에서 고른 것이 "없는 마디" 로 잘려 나간다.

export interface ExtensionPicks {
  /** 뷰 id → 그 트리에서 고른 것 */
  of(viewId: string): ReadonlySet<string>
  set(viewId: string, picked: ReadonlySet<string>): void
  /** 모든 트리에서 고른 것을 합친 것. 명령에 실려 나간다 */
  selection: string[]
  /**
   * 전부 푼다. **탭을 가리지 않는다** — 명령에 실려 나간 것이 여러 탭에 걸쳐 있다.
   *
   * 주 행동이 **성공했을 때만** 부른다 (`ExtensionViewPanel`). 실패·중단에는 안 푼다:
   * 그 선택이 곧 다시 돌릴 대상이라, 풀어 버리면 수십 개를 처음부터 다시 골라야 한다.
   */
  clear(): void
}

export function useExtensionPicks(projectId: string | null, treesByView: Record<string, TreeNode[]>): ExtensionPicks {
  const [byProject, setByProject] = useState<Record<string, Record<string, ReadonlySet<string>>>>({})
  const picks = (projectId === null ? undefined : byProject[projectId]) ?? EMPTY_VIEWS
  const setPicks = useCallback(
    (update: (previous: Record<string, ReadonlySet<string>>) => Record<string, ReadonlySet<string>>) => {
      if (projectId === null) return
      setByProject((previous) => {
        const next = update(previous[projectId] ?? EMPTY_VIEWS)
        return next === (previous[projectId] ?? EMPTY_VIEWS) ? previous : { ...previous, [projectId]: next }
      })
    },
    [projectId],
  )

  // 목록을 다시 만들면 사라진 항목이 생긴다. 남겨 두면 **화면에 없는 것이 명령에 실린다** —
  // 사용자는 자기가 고른 적 없는 대상의 결과를 받는다.
  //
  // 아직 안 돌린 뷰(`undefined`)는 건드리지 않는다. 거기서 걸러내면 트리가 오기 전에
  // 선택이 통째로 날아간다.
  useEffect(() => {
    setPicks((previous) => {
      let changed = false
      const next: Record<string, ReadonlySet<string>> = {}
      for (const [viewId, picked] of Object.entries(previous)) {
        const nodes = treesByView[viewId]
        if (nodes === undefined) {
          next[viewId] = picked
          continue
        }
        const alive = prunedSelection(nodes, picked)
        if (alive.size !== picked.size) changed = true
        next[viewId] = alive
      }
      return changed ? next : previous
    })
  }, [treesByView, setPicks])

  const of = useCallback((viewId: string) => picks[viewId] ?? EMPTY, [picks])
  const set = useCallback(
    (viewId: string, picked: ReadonlySet<string>) => {
      setPicks((previous) => ({ ...previous, [viewId]: picked }))
    },
    [setPicks],
  )
  // 뷰 선언 순서가 아니라 고른 순서로 모인다 — 명령에 싣는 데는 순서가 중요하지 않다
  const selection = useMemo(() => Object.values(picks).flatMap((picked) => [...picked]), [picks])

  // **빈 것을 다시 넣지 않는다** — 뷰마다 새 Set 을 깔면 아래 걸러내기 효과가 매번
  // "바뀌었다" 로 읽어 렌더가 한 번 더 돈다. 이미 비었으면 그대로 둔다.
  const clear = useCallback(() => {
    setPicks((previous) => (Object.keys(previous).length === 0 ? previous : EMPTY_VIEWS))
  }, [setPicks])

  return { of, set, selection, clear }
}

/** 매번 새 Set 을 만들면 `of()` 를 쓰는 쪽이 매 렌더 다시 그려진다. */
const EMPTY: ReadonlySet<string> = new Set()
const EMPTY_VIEWS: Record<string, ReadonlySet<string>> = {}
