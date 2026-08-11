import { MessageKind, hasContent, isRenderableKind, type ChatMessage } from './messageModel'

// 턴 안의 메시지를 렌더 노드로 쪼갠다 (설계 §6.3, vscode buildTurnNodes MessageList.tsx:295-307).
//
// 핵심 규칙: 연속한 도구 호출은 하나의 tools 노드로 묶이고,
// 도구 사이에 비도구 메시지가 끼면 묶음이 쪼개진다.
// 이 규칙 때문에 "N개 작업" 카운터가 나뉘어 표시되는 경우가 생긴다.

export type TurnNode = { kind: 'tools'; tools: ChatMessage[] } | { kind: 'item'; msg: ChatMessage }

export function buildTurnNodes(messages: ChatMessage[]): TurnNode[] {
  const nodes: TurnNode[] = []

  for (const message of messages) {
    if (message.kind === MessageKind.TOOL_CALL) {
      const previous = nodes[nodes.length - 1]
      // 직전 노드가 tools 면 합류, 아니면 새 묶음을 연다
      if (previous?.kind === 'tools') previous.tools.push(message)
      else nodes.push({ kind: 'tools', tools: [message] })
      continue
    }
    nodes.push({ kind: 'item', msg: message })
  }

  return nodes
}

/** 화면에 무언가를 그리는 노드인가 (MessageList.tsx:312, :419) */
export function isRenderableNode(node: TurnNode): boolean {
  if (node.kind === 'tools') return node.tools.length > 0
  if (!isRenderableKind(node.msg.kind)) return false
  // 빈 TEXT·THINKING 은 렌더하지 않는다
  if (node.msg.kind === MessageKind.TEXT || node.msg.kind === MessageKind.THINKING) {
    return hasContent(node.msg)
  }
  return true
}

/**
 * rail(세로선)이 지나가는 노드인가 (MessageList.tsx:316-323).
 * 도구 묶음, 그리고 내용이 있는 TEXT/THINKING/ERROR 아이템만 해당한다.
 */
export function isRailNode(node: TurnNode): boolean {
  if (node.kind === 'tools') return node.tools.length > 0
  const { msg } = node
  if (
    msg.kind !== MessageKind.TEXT &&
    msg.kind !== MessageKind.THINKING &&
    msg.kind !== MessageKind.ERROR
  ) {
    return false
  }
  return hasContent(msg)
}

/** 도구가 진행 중인가 — 결과가 아직 안 붙은 게 하나라도 있으면 진행 중 (MessageList.tsx:148) */
export function hasRunningTool(tools: ChatMessage[]): boolean {
  return tools.some((tool) => !tool.toolResult)
}

/** 완료된 도구 수 (MessageList.tsx:177) */
export function completedToolCount(tools: ChatMessage[]): number {
  return tools.filter((tool) => Boolean(tool.toolResult)).length
}
