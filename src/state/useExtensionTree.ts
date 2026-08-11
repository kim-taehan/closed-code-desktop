import type { TreeNode } from './extensionTree'
import { useProjectViewCache } from './useProjectViewCache'

// 확장이 넘긴 트리를 뷰별로 들고 있는 상태. 규칙은 `useExtensionRows` 와 같다 —
// **여기서 IPC 를 부르지 않고**, 겉봉이 다른 프로젝트 것이면 버리고, 프로젝트별로 나눠 쥔다.
//
// 셋 중 **트리가 나눠 쥐기를 가장 크게 탄다.** 프로젝트를 옮길 때 비우면 트리가 화면에서
// 사라지고, 펼침은 그리는 쪽의 상태라 같이 죽어 돌아왔을 때 903줄이 통째로 접혀 있다.
// (펼침 자체를 남기는 것은 `useExtensionExpanded` 몫이다 — 여기는 그릴 것을 남긴다.)

export type ExtensionTreesByView = Record<string, TreeNode[]>

export interface ExtensionTreeHandle {
  treesByView: ExtensionTreesByView
  /** 밀려온 트리를 반영한다. 같은 뷰에 다시 오면 **통째 교체**다 (행·화면과 같다). */
  apply: (projectId: string, viewId: string, nodes: TreeNode[]) => void
}

export function useExtensionTree(projectId: string | null): ExtensionTreeHandle {
  const { byView, apply } = useProjectViewCache<TreeNode[]>(projectId)
  return { treesByView: byView, apply }
}
