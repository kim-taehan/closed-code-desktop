import { isRailNode, type TurnNode } from './turnNodes'

// rail(왼쪽 세로선)의 끝 노드를 찾는다 (설계 §6.9, vscode MessageList.tsx:366-368).
//
// 마지막 rail 노드에만 cc-rail-end 가 붙어 선이 거기서 잘린다.
// 이게 없으면 세로선이 턴 아래로 계속 흘러내린다.

export type RailEdge = 'start' | 'end' | undefined

/** rail 이 지나가는 노드들의 인덱스 */
export function railNodeIndexes(nodes: TurnNode[]): number[] {
  const indexes: number[] = []
  nodes.forEach((node, index) => {
    if (isRailNode(node)) indexes.push(index)
  })
  return indexes
}

/** 마지막 rail 노드의 인덱스. 없으면 -1 */
export function lastRailNodeIndex(nodes: TurnNode[]): number {
  const indexes = railNodeIndexes(nodes)
  return indexes.length > 0 ? indexes[indexes.length - 1]! : -1
}

/** 해당 인덱스 노드에 붙일 rail 표시 */
export function railEdgeFor(nodes: TurnNode[], index: number): RailEdge {
  return index === lastRailNodeIndex(nodes) ? 'end' : undefined
}
