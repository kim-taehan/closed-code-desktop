import { useCallback, useState } from 'react'

// 확장이 밀어 올린 것을 **프로젝트별·뷰별로** 들고 있는 자리.
// 행·화면·트리 셋이 규칙이 같아 여기서 한 번만 쓴다
// (`useExtensionHtml` 이 예고한 "셋째가 생기면 그때 뽑는다").
//
// **프로젝트를 옮길 때 비우지 않고 프로젝트별로 나눠 쥔다.** 비우면 돌아왔을 때 화면이
// 처음 상태로 되돌아간다 — 특히 트리는 통째로 접힌다. 비우는 순간 「아직 실행하지
// 않았습니다」로 바뀌며 트리가 화면에서 사라지고, 펼침은 그리는 쪽이 쥔 상태라 같이 죽는다.
// 다시 밀려온 트리는 전부 접힌 채로 새로 태어난다.
//
// 나눠 쥐어도 **남의 프로젝트 것이 보일 일은 없다** — 비우는 규칙이 막던 것이 그것이고,
// 프로젝트로 가른 칸은 그것을 구조로 막는다.

export interface ProjectViewCache<T> {
  /** 지금 보는 프로젝트의 뷰별 값. 없으면 빈 객체 */
  byView: Record<string, T>
  /**
   * 밀려온 값을 반영한다. 겉봉의 `projectId` 가 지금 보는 프로젝트와 다르면 버린다
   * (`useGitState.ts:58-65` 와 같은 규칙).
   *
   * 같은 뷰에 다시 오면 **덮어쓴다.** 밀어 넣기는 이어붙이기가 아니라 통째 교체다.
   */
  apply: (projectId: string, viewId: string, value: T) => void
}

/** 매번 새 객체를 만들면 이것을 의존성으로 쓰는 쪽이 매 렌더 다시 돈다. */
const EMPTY: Record<string, never> = {}

export function useProjectViewCache<T>(projectId: string | null): ProjectViewCache<T> {
  const [byProject, setByProject] = useState<Record<string, Record<string, T>>>({})

  const apply = useCallback(
    (incomingProjectId: string, viewId: string, value: T) => {
      if (incomingProjectId !== projectId) return
      setByProject((previous) => ({
        ...previous,
        [incomingProjectId]: { ...previous[incomingProjectId], [viewId]: value },
      }))
    },
    [projectId],
  )

  // ponytail: 들른 프로젝트만큼 쌓이고 비우지 않는다. 한 세션에서 프로젝트를 수십 개
  // 여는 사용이 나오면 프로젝트 탭을 닫을 때 그 칸을 지우는 자리가 필요하다.
  const byView = (projectId === null ? undefined : byProject[projectId]) ?? EMPTY
  return { byView, apply }
}
