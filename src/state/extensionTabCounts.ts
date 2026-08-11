import { leavesOfAll, matchingTree, segmentTree, type TreeNode } from './extensionTree'
import type { ExtensionRowsByView } from './extensionRows'
import type { TabCount } from '../components/ExtensionViewTabs'

// 뷰 탭에 붙는 **개수 배지**를 센다.
//
// `ExtensionViewPanel` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았다. 좁히기 조건을 받아
// 세기만 하는 순수 계산이라 화면과 함께 있을 이유도 없다.

/** 칩(경로 조각)과 글을 **겹쳐** 건 트리. 둘 다 AND 로 좁힌다. */
export function narrowTree(tree: TreeNode[], segment: string, find: string): TreeNode[] {
  return matchingTree(segmentTree(tree, segment), find)
}

/**
 * 그 탭에 **좁힌 것 / 전부**가 몇인가. 아직 안 돌린 뷰는 `undefined` 라 아무것도 안 붙는다.
 *
 * 좁히기는 보고 있는 탭에만 걸리는 것이 아니라 **모든 탭에 같이** 걸린다. 예전에는 배지가
 * 전체 수 그대로여서 「`controller` 로 좁혔더니 API 탭은 0건」 같은 사실이 아무 데도
 * 안 보였다 (`_workspace/87_explore` §3-4).
 *
 * 표(`rows`)는 이 좁히기를 안 받는다 — 둘이 같으면 탭은 숫자 하나만 그린다.
 */
export function tabCountOf(
  viewId: string,
  trees: Record<string, TreeNode[]>,
  rows: ExtensionRowsByView,
  segment: string,
  find: string,
): TabCount | undefined {
  const tree = trees[viewId]
  if (tree !== undefined) {
    return { shown: leavesOfAll(narrowTree(tree, segment, find)).length, total: leavesOfAll(tree).length }
  }
  const total = rows[viewId]?.length
  return total === undefined ? undefined : { shown: total, total }
}
