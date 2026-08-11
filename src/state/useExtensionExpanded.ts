import { useCallback, useMemo, useState } from 'react'

// 트리에서 **펼쳐 둔 가지**를 프로젝트별·뷰별로 쥔다.
//
// 원래는 그리는 쪽(`ExtensionTree` 의 `TreeItem`)이 자기 안에 쥐고 있었다. 그러면 트리가
// 화면에서 사라지는 순간 같이 죽는다 — 프로젝트 탭을 다녀오면 903줄짜리가 통째로 접혀
// 있고, 사용자는 파고들던 자리를 처음부터 다시 찾아야 한다.
//
// **그리는 자리보다 오래 사는 곳에 둔다** (`useExtensionPanel` → `ProjectSidebar`).
// 사이드바는 프로젝트를 옮겨도, 보는 확장을 바꿔도 다시 태어나지 않는다.
//
// 뷰로 한 번 더 가르는 이유는 고른 것(`extensionPicks`)과 같다 — 화면 탭과 API 탭은
// 서로 다른 트리이고, 한 탭에서 편 것이 다른 탭의 같은 이름 가지를 펴면 안 된다.

export interface ExtensionExpanded {
  /** 그 뷰에서 펼쳐 둔 마디 id 들 */
  of(viewId: string): ReadonlySet<string>
  /** 그 마디를 폈다 접었다 한다 */
  toggle(viewId: string, nodeId: string): void
}

/** 매번 새 Set 을 만들면 `of()` 를 쓰는 쪽이 매 렌더 다시 그려진다. */
const EMPTY: ReadonlySet<string> = new Set()

type ExpandedByProject = Record<string, Record<string, ReadonlySet<string>>>

export function useExtensionExpanded(projectId: string | null): ExtensionExpanded {
  const [byProject, setByProject] = useState<ExpandedByProject>({})

  // 사라진 마디의 id 는 그냥 남는다. **골라 둔 것과 달리 위험하지 않다** — 고른 것은
  // 명령에 실려 나가지만(`prunedSelection` 이 거르는 이유), 펼침은 없는 마디를 찾아보고
  // 마는 값이라 화면에도 명령에도 새어 나갈 곳이 없다.
  const byView = (projectId === null ? undefined : byProject[projectId]) ?? EMPTY_VIEWS

  const of = useCallback((viewId: string) => byView[viewId] ?? EMPTY, [byView])

  const toggle = useCallback(
    (viewId: string, nodeId: string) => {
      if (projectId === null) return
      setByProject((previous) => {
        const views = previous[projectId] ?? {}
        const next = new Set(views[viewId] ?? EMPTY)
        if (!next.delete(nodeId)) next.add(nodeId)
        return { ...previous, [projectId]: { ...views, [viewId]: next } }
      })
    },
    [projectId],
  )

  return useMemo(() => ({ of, toggle }), [of, toggle])
}

const EMPTY_VIEWS: Record<string, ReadonlySet<string>> = {}
