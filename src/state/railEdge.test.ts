import { describe, expect, it } from 'vitest'
import { MessageKind, type ChatMessage } from './messageModel'
import type { TurnNode } from './turnNodes'
import { lastRailNodeIndex, railEdgeFor, railNodeIndexes } from './railEdge'

// railEdge 는 세로선(rail)이 어디서 끊길지 정한다:
// 마지막 rail 노드에만 'end' 가 붙어야 선이 턴 아래로 흘러내리지 않는다.

function textNode(content: string): TurnNode {
  const msg: ChatMessage = { id: 't', author: 'assistant', kind: MessageKind.TEXT, content }
  return { kind: 'item', msg }
}

function toolsNode(count: number): TurnNode {
  const tools: ChatMessage[] = Array.from({ length: count }, (_, i) => ({
    id: `tool-${i}`,
    author: 'assistant',
    kind: MessageKind.TOOL_CALL,
    content: '',
  }))
  return { kind: 'tools', tools }
}

describe('railNodeIndexes — rail 노드들의 인덱스', () => {
  it('rail 노드의 인덱스만 모은다', () => {
    // 0: rail(text), 1: 비rail(빈 text), 2: rail(tools)
    const nodes = [textNode('답'), textNode('  '), toolsNode(1)]
    expect(railNodeIndexes(nodes)).toEqual([0, 2])
  })

  it('rail 노드가 없으면 빈 배열', () => {
    expect(railNodeIndexes([textNode(''), toolsNode(0)])).toEqual([])
  })

  it('빈 노드 목록은 빈 배열', () => {
    expect(railNodeIndexes([])).toEqual([])
  })
})

describe('lastRailNodeIndex — 마지막 rail 노드', () => {
  it('마지막 rail 노드의 인덱스를 준다', () => {
    const nodes = [textNode('답'), toolsNode(1), textNode(' ')]
    expect(lastRailNodeIndex(nodes)).toBe(1)
  })

  it('rail 노드가 없으면 -1', () => {
    expect(lastRailNodeIndex([textNode('')])).toBe(-1)
  })

  it('빈 목록은 -1', () => {
    expect(lastRailNodeIndex([])).toBe(-1)
  })
})

describe('railEdgeFor — 인덱스에 붙일 rail 표시', () => {
  it('마지막 rail 노드면 end', () => {
    const nodes = [textNode('답'), toolsNode(1)]
    expect(railEdgeFor(nodes, 1)).toBe('end')
  })

  it('마지막이 아닌 rail 노드는 표시 없음', () => {
    const nodes = [textNode('답'), toolsNode(1)]
    expect(railEdgeFor(nodes, 0)).toBeUndefined()
  })

  it('rail 이 아닌 인덱스는 표시 없음', () => {
    const nodes = [textNode('답'), textNode('  ')]
    expect(railEdgeFor(nodes, 1)).toBeUndefined()
  })

  it('rail 노드가 하나도 없으면 어떤 인덱스도 end 가 아니다', () => {
    const nodes = [textNode(''), toolsNode(0)]
    expect(railEdgeFor(nodes, 0)).toBeUndefined()
    expect(railEdgeFor(nodes, 1)).toBeUndefined()
    // lastRailNodeIndex 가 -1 이라 index -1 을 주면 end 가 된다 (실사용에선 안 넘어옴)
    expect(railEdgeFor(nodes, -1)).toBe('end')
  })
})
