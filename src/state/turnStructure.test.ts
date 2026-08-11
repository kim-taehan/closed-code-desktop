import { describe, expect, it } from 'vitest'
import { MessageKind, type ChatMessage, type TurnMeta } from './messageModel'
import { buildTurnNodes, completedToolCount, hasRunningTool, isRailNode, isRenderableNode } from './turnNodes'
import { extractReply, isTurnInterrupted } from './replyExtraction'
import { groupMessages, type TurnEntry } from './turnGrouping'
import { lastRailNodeIndex, railEdgeFor } from './railEdge'

// 설계 §9.2 의 시나리오를 컴포넌트 없이 고정한다.
// 여기서 규칙이 틀리면 B3~B7 컴포넌트를 아무리 잘 짜도 화면이 어긋난다.

let counter = 0
const nextId = () => `m${counter++}`

function text(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: nextId(), author: 'assistant', kind: MessageKind.TEXT, content, ...extra }
}

function tool(toolName: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: nextId(), author: 'assistant', kind: MessageKind.TOOL_CALL, content: '', toolName, ...extra }
}

function user(content: string): ChatMessage {
  return { id: nextId(), author: 'user', kind: MessageKind.TEXT, content }
}

function errorMsg(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: nextId(), author: 'assistant', kind: MessageKind.ERROR, content, ...extra }
}

const turns = (entries: ReturnType<typeof groupMessages>) =>
  entries.filter((entry): entry is TurnEntry => entry.kind === 'turn')

describe('buildTurnNodes — 도구 묶음', () => {
  it('연속한 도구는 한 묶음이 된다', () => {
    const nodes = buildTurnNodes([tool('read_file'), tool('edit_file'), tool('run_command')])

    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.kind).toBe('tools')
    if (nodes[0]!.kind === 'tools') expect(nodes[0]!.tools).toHaveLength(3)
  })

  it('도구 사이에 텍스트가 끼면 묶음이 쪼개진다', () => {
    // 설계 §6.5 의 핵심 규칙. 이걸 놓치면 카운터가 하나로 합쳐져 보인다.
    const nodes = buildTurnNodes([tool('read_file'), text('중간 설명'), tool('edit_file'), tool('run_command')])

    expect(nodes.map((node) => node.kind)).toEqual(['tools', 'item', 'tools'])
    if (nodes[0]!.kind === 'tools') expect(nodes[0]!.tools).toHaveLength(1)
    if (nodes[2]!.kind === 'tools') expect(nodes[2]!.tools).toHaveLength(2)
  })

  it('도구가 아닌 메시지는 각자 아이템 노드가 된다', () => {
    const nodes = buildTurnNodes([text('가'), text('나')])
    expect(nodes.map((node) => node.kind)).toEqual(['item', 'item'])
  })

  it('빈 배열이면 노드도 없다', () => {
    expect(buildTurnNodes([])).toEqual([])
  })
})

describe('도구 진행 상태', () => {
  it('결과가 안 붙은 도구가 있으면 진행 중이다', () => {
    expect(hasRunningTool([tool('a'), tool('b', { toolResult: { success: true } })])).toBe(true)
  })

  it('전부 결과가 붙으면 진행 중이 아니다', () => {
    const tools = [tool('a', { toolResult: { success: true } }), tool('b', { toolResult: { error: 'x' } })]
    expect(hasRunningTool(tools)).toBe(false)
    expect(completedToolCount(tools)).toBe(2)
  })
})

describe('isRenderableNode — 무엇이 화면을 만드는가', () => {
  it('내용 있는 텍스트는 렌더된다', () => {
    expect(isRenderableNode({ kind: 'item', msg: text('내용') })).toBe(true)
  })

  it('공백뿐인 텍스트는 렌더되지 않는다', () => {
    expect(isRenderableNode({ kind: 'item', msg: text('   \n  ') })).toBe(false)
  })

  it('도구가 없는 빈 묶음은 렌더되지 않는다', () => {
    expect(isRenderableNode({ kind: 'tools', tools: [] })).toBe(false)
  })

  it('system 메시지는 턴 안에서 렌더되지 않는다', () => {
    const msg: ChatMessage = { id: nextId(), author: 'assistant', kind: MessageKind.SYSTEM, content: '내용' }
    expect(isRenderableNode({ kind: 'item', msg })).toBe(false)
  })
})

describe('extractReply — 답변 골라내기', () => {
  it("semanticType='reply' 가 중간에 있어도 그것이 답변이 된다", () => {
    const target = text('이게 답변', { semanticType: 'reply' })
    const messages = [text('계획', { semanticType: 'plan' }), target, text('덧붙임', { semanticType: 'reflection' })]

    const reply = extractReply(messages, { turnEnded: true, turnInterrupted: false })
    expect(reply?.id).toBe(target.id)
  })

  it("턴이 안 끝났어도 semanticType='reply' 는 뽑는다", () => {
    const target = text('진행 중 답변', { semanticType: 'reply' })
    const reply = extractReply([text('계획'), target], { turnEnded: false, turnInterrupted: false })
    expect(reply?.id).toBe(target.id)
  })

  it('reply 표시가 없으면 턴이 끝났을 때만 마지막 텍스트를 쓴다', () => {
    const last = text('마지막')
    const messages = [text('처음'), last]

    expect(extractReply(messages, { turnEnded: true, turnInterrupted: false })?.id).toBe(last.id)
    expect(extractReply(messages, { turnEnded: false, turnInterrupted: false })).toBeUndefined()
  })

  it('중단된 턴에서는 답변을 뽑지 않는다', () => {
    const messages = [text('답변', { semanticType: 'reply' })]
    expect(extractReply(messages, { turnEnded: true, turnInterrupted: true })).toBeUndefined()
  })

  it('빈 텍스트는 답변 후보가 아니다', () => {
    const messages = [text('내용 있음'), text('   ')]
    expect(extractReply(messages, { turnEnded: true, turnInterrupted: false })?.content).toBe('내용 있음')
  })

  it('텍스트가 하나도 없으면 답변이 없다', () => {
    expect(extractReply([tool('read_file')], { turnEnded: true, turnInterrupted: false })).toBeUndefined()
  })

  it('interrupted 메시지가 하나라도 있으면 중단된 턴이다', () => {
    expect(isTurnInterrupted([text('가'), text('나', { interrupted: true })])).toBe(true)
    expect(isTurnInterrupted([text('가')])).toBe(false)
  })
})

describe('groupMessages — 턴 묶기', () => {
  it('사용자 메시지는 턴 밖에서 단독 렌더된다', () => {
    const entries = groupMessages([user('질문'), text('답변', { turnId: 't1' })])

    expect(entries[0]!.kind).toBe('single')
    expect(entries[1]!.kind).toBe('turn')
  })

  it('같은 turnId 의 연속 구간이 한 턴이 된다', () => {
    const entries = groupMessages([
      text('가', { turnId: 't1' }),
      tool('read_file', { turnId: 't1' }),
      text('나', { turnId: 't1' }),
    ])

    expect(turns(entries)).toHaveLength(1)
    expect(turns(entries)[0]!.messages).toHaveLength(3)
  })

  it('turnId 가 바뀌면 턴이 나뉜다', () => {
    const entries = groupMessages([text('가', { turnId: 't1' }), text('나', { turnId: 't2' })])

    const grouped = turns(entries)
    expect(grouped).toHaveLength(2)
    expect(grouped[0]!.turnId).toBe('t1')
    expect(grouped[1]!.turnId).toBe('t2')
  })

  it('사용자 메시지가 끼면 같은 turnId 라도 구간이 끊긴다', () => {
    const entries = groupMessages([
      text('가', { turnId: 't1' }),
      user('중간 질문'),
      text('나', { turnId: 't1' }),
    ])

    expect(entries.map((entry) => entry.kind)).toEqual(['turn', 'single', 'turn'])
  })

  it('meta.terminal 이 정본이고 없으면 경계로 판단한다', () => {
    const metas = new Map<string, TurnMeta>([['t1', { turnId: 't1', terminal: false }]])
    const messages = [text('가', { turnId: 't1' }), user('다음')]

    // 경계상으로는 끝났지만 meta 가 terminal:false 라고 하면 안 끝난 것이다
    expect(turns(groupMessages(messages, metas))[0]!.turnEnded).toBe(false)
    // meta 가 없으면 경계로 판단한다
    expect(turns(groupMessages(messages))[0]!.turnEnded).toBe(true)
  })

  it('마지막 그룹만 isLastGroup 이다', () => {
    const entries = groupMessages([text('가', { turnId: 't1' }), user('질문'), text('나', { turnId: 't2' })])
    const grouped = turns(entries)

    expect(grouped[0]!.isLastGroup).toBe(false)
    expect(grouped[1]!.isLastGroup).toBe(true)
  })

  it('turnId 없는 ERROR 는 단독 렌더된다', () => {
    const entries = groupMessages([errorMsg('실패')])
    expect(entries[0]!.kind).toBe('single')
  })

  it('turnId 없는 assistant 메시지는 레거시 턴으로 묶인다', () => {
    const entries = groupMessages([text('가'), text('나')])
    const grouped = turns(entries)

    expect(grouped).toHaveLength(1)
    expect(grouped[0]!.turnId).toBeUndefined()
    expect(grouped[0]!.messages).toHaveLength(2)
  })

  it('레거시 턴은 ERROR 에서 끊긴다', () => {
    const entries = groupMessages([text('가'), errorMsg('실패'), text('나')])
    expect(entries.map((entry) => entry.kind)).toEqual(['turn', 'single', 'turn'])
  })

  it('빈 배열이면 결과도 비어 있다', () => {
    expect(groupMessages([])).toEqual([])
  })
})

describe('railEdge — 세로선 끝', () => {
  it('마지막 rail 노드에만 end 가 붙는다', () => {
    const nodes = buildTurnNodes([tool('read_file'), text('설명'), text('답변')])

    expect(lastRailNodeIndex(nodes)).toBe(2)
    expect(railEdgeFor(nodes, 0)).toBeUndefined()
    expect(railEdgeFor(nodes, 2)).toBe('end')
  })

  it('빈 텍스트는 rail 노드가 아니라 그 앞이 끝이 된다', () => {
    const nodes = buildTurnNodes([text('설명'), text('   ')])
    expect(lastRailNodeIndex(nodes)).toBe(0)
  })

  it('rail 노드가 없으면 -1 이다', () => {
    const nodes = buildTurnNodes([text('  ')])
    expect(lastRailNodeIndex(nodes)).toBe(-1)
    expect(isRailNode(nodes[0]!)).toBe(false)
  })
})

describe('§9.2 시나리오 — 렌더 가능 노드가 0인 턴', () => {
  it('아무것도 그릴 게 없으면 렌더 가능 노드가 하나도 없다', () => {
    // 이 경우 vscode 는 헤더조차 그리지 않는다 (MessageList.tsx:460-461)
    const nodes = buildTurnNodes([text('   '), text('')])
    expect(nodes.filter(isRenderableNode)).toHaveLength(0)
  })
})

describe('§9.2 시나리오 — 중단된 턴 레이아웃 분기', () => {
  it('렌더 가능 노드가 1개면 body 가 비고 그 노드가 답변 자리로 간다', () => {
    const messages = [text('유일한 내용', { interrupted: true })]
    const nodes = buildTurnNodes(messages).filter(isRenderableNode)

    expect(nodes).toHaveLength(1)
    // 중단된 턴이라 reply 추출은 하지 않는다 — 레이아웃 예외로 처리된다
    expect(extractReply(messages, { turnEnded: true, turnInterrupted: true })).toBeUndefined()
  })

  it('렌더 가능 노드가 2개 이상이면 전부 body 로 간다', () => {
    const messages = [text('첫째'), tool('read_file'), text('둘째', { interrupted: true })]
    const nodes = buildTurnNodes(messages).filter(isRenderableNode)

    expect(nodes.length).toBeGreaterThanOrEqual(2)
    expect(isTurnInterrupted(messages)).toBe(true)
  })
})
