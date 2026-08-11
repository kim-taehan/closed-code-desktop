import { describe, expect, it } from 'vitest'
import { MessageKind, type ChatMessage } from './messageModel'
import {
  buildTurnNodes,
  completedToolCount,
  hasRunningTool,
  isRailNode,
  isRenderableNode,
  type TurnNode,
} from './turnNodes'

// turnNodes 는 턴 안을 렌더 노드로 쪼갠다:
// 연속한 도구 호출은 한 tools 노드로 묶이고, 사이에 비도구가 끼면 묶음이 쪼개진다.

function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm', author: 'assistant', kind: MessageKind.TEXT, content: '내용', ...overrides }
}

function tool(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return msg({ kind: MessageKind.TOOL_CALL, content: '', ...overrides })
}

describe('buildTurnNodes — 노드 쪼개기', () => {
  it('빈 배열은 빈 노드', () => {
    expect(buildTurnNodes([])).toEqual([])
  })

  it('연속한 도구 호출은 하나의 tools 노드로 묶인다', () => {
    const nodes = buildTurnNodes([tool({ id: 'a' }), tool({ id: 'b' })])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kind: 'tools' })
    expect((nodes[0] as { tools: ChatMessage[] }).tools.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('도구 사이에 비도구가 끼면 묶음이 쪼개진다', () => {
    const nodes = buildTurnNodes([tool({ id: 'a' }), msg({ id: 't', content: '설명' }), tool({ id: 'b' })])
    expect(nodes.map((n) => n.kind)).toEqual(['tools', 'item', 'tools'])
  })

  it('비도구 메시지는 각각 item 노드', () => {
    const nodes = buildTurnNodes([msg({ id: 'a' }), msg({ id: 'b', kind: MessageKind.ERROR })])
    expect(nodes.map((n) => n.kind)).toEqual(['item', 'item'])
  })
})

describe('isRenderableNode — 그리는 노드인가', () => {
  it('도구가 든 tools 노드는 렌더한다', () => {
    expect(isRenderableNode({ kind: 'tools', tools: [tool()] })).toBe(true)
  })

  it('빈 tools 노드는 렌더하지 않는다', () => {
    expect(isRenderableNode({ kind: 'tools', tools: [] })).toBe(false)
  })

  it('렌더 불가능한 kind(SYSTEM) 아이템은 거짓', () => {
    expect(isRenderableNode({ kind: 'item', msg: msg({ kind: MessageKind.SYSTEM }) })).toBe(false)
  })

  it('빈 TEXT 아이템은 렌더하지 않는다', () => {
    expect(isRenderableNode({ kind: 'item', msg: msg({ content: '   ' }) })).toBe(false)
  })

  it('내용 있는 TEXT 아이템은 렌더한다', () => {
    expect(isRenderableNode({ kind: 'item', msg: msg({ content: '답' }) })).toBe(true)
  })

  it('ERROR 는 내용이 비어도 렌더한다 (TEXT 만 내용 검사)', () => {
    expect(isRenderableNode({ kind: 'item', msg: msg({ kind: MessageKind.ERROR, content: '' }) })).toBe(true)
  })

  it('AGENT_TASK_START 는 내용과 무관하게 렌더한다', () => {
    const node: TurnNode = { kind: 'item', msg: msg({ kind: MessageKind.AGENT_TASK_START, content: '' }) }
    expect(isRenderableNode(node)).toBe(true)
  })
})

describe('isRailNode — 세로선이 지나가는 노드인가', () => {
  it('도구가 든 tools 노드는 rail', () => {
    expect(isRailNode({ kind: 'tools', tools: [tool()] })).toBe(true)
  })

  it('빈 tools 노드는 rail 아님', () => {
    expect(isRailNode({ kind: 'tools', tools: [] })).toBe(false)
  })

  it('내용 있는 TEXT/ERROR 는 rail', () => {
    expect(isRailNode({ kind: 'item', msg: msg({ content: '답' }) })).toBe(true)
    expect(isRailNode({ kind: 'item', msg: msg({ kind: MessageKind.ERROR, content: '오류' }) })).toBe(true)
  })

  it('빈 TEXT/ERROR 는 rail 아님', () => {
    expect(isRailNode({ kind: 'item', msg: msg({ content: ' ' }) })).toBe(false)
    expect(isRailNode({ kind: 'item', msg: msg({ kind: MessageKind.ERROR, content: '' }) })).toBe(false)
  })

  it('TEXT/ERROR 가 아닌 kind 는 rail 아님', () => {
    expect(isRailNode({ kind: 'item', msg: msg({ kind: MessageKind.CODE_DIFF, content: 'x' }) })).toBe(false)
    expect(isRailNode({ kind: 'item', msg: msg({ kind: MessageKind.AGENT_TASK_START, content: 'x' }) })).toBe(false)
  })
})

describe('hasRunningTool / completedToolCount — 진행·완료 집계', () => {
  it('결과 안 붙은 도구가 하나라도 있으면 진행 중', () => {
    expect(hasRunningTool([tool({ toolResult: { message: '완료' } }), tool()])).toBe(true)
  })

  it('전부 결과가 붙으면 진행 중 아님', () => {
    expect(hasRunningTool([tool({ toolResult: { message: 'a' } }), tool({ toolResult: { message: 'b' } })])).toBe(false)
  })

  it('빈 배열은 진행 중 아님', () => {
    expect(hasRunningTool([])).toBe(false)
  })

  it('완료된 도구 수를 센다', () => {
    expect(completedToolCount([tool({ toolResult: { message: 'a' } }), tool()])).toBe(1)
    expect(completedToolCount([])).toBe(0)
  })
})
