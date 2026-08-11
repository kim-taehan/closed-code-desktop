import type { ChatMessage, ToolResult } from '../../shared/ipc/messageTypes'
import { MessageKind } from '../../shared/ipc/messageTypes'

// tool_result 를 기존 tool_call 에 접는다 (설계 §5.2).
//
// tool_result 는 자기 메시지를 만들지 않는다. 짝을 못 찾으면 vscode 와 동일하게 폐기한다
// (messageHandlers.ts:77-79). 임의로 새 메시지를 만들지 않는 것이 중요하다 —
// 그러면 화면에 짝 없는 도구 결과가 유령처럼 뜬다.

export interface ToolResultChunkData {
  toolCallId?: string
  toolName?: string
  result?: unknown
  success?: boolean
  error?: string
}

export interface FoldOutcome {
  messages: ChatMessage[]
  /** 짝을 찾아 접었는가. false 면 폐기된 것이다. */
  folded: boolean
}

/**
 * 매칭 우선순위:
 *  1. toolCallId 가 같은 tool_call
 *  2. toolCallId 가 없는 경우, 같은 streamId 의 결과 없는 마지막 tool_call
 */
export function foldToolResult(
  messages: ChatMessage[],
  data: ToolResultChunkData,
  streamId?: string,
): FoldOutcome {
  const index = findTargetIndex(messages, data, streamId)
  if (index < 0) return { messages, folded: false }

  const target = messages[index]!
  const next = [...messages]
  next[index] = { ...target, toolResult: toToolResult(data) }
  return { messages: next, folded: true }
}

function findTargetIndex(
  messages: ChatMessage[],
  data: ToolResultChunkData,
  streamId?: string,
): number {
  if (data.toolCallId) {
    const byId = lastIndexWhere(
      messages,
      (message) => message.kind === MessageKind.TOOL_CALL && message.toolCallId === data.toolCallId,
    )
    if (byId >= 0) return byId
  }

  // toolCallId 가 없을 때만 streamId 로 되짚는다
  if (!data.toolCallId && streamId) {
    return lastIndexWhere(
      messages,
      (message) =>
        message.kind === MessageKind.TOOL_CALL && message.streamId === streamId && !message.toolResult,
    )
  }

  return -1
}

function toToolResult(data: ToolResultChunkData): ToolResult {
  const result: ToolResult = {}
  const message = extractMessage(data.result)
  if (message !== undefined) result.message = message
  if (data.result !== undefined) result.raw = data.result
  if (data.success !== undefined) result.success = data.success
  if (data.error !== undefined) result.error = data.error
  // 성공/실패 표시가 전혀 없으면 error 유무로 정한다
  if (result.success === undefined) result.success = data.error === undefined
  return result
}

/** result 는 문자열일 수도, 객체일 수도 있다. 화면에 쓸 문자열로 만든다. */
function extractMessage(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined
  if (typeof result === 'string') return result
  return JSON.stringify(result, null, 2)
}

function lastIndexWhere(messages: ChatMessage[], predicate: (message: ChatMessage) => boolean): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (predicate(messages[index]!)) return index
  }
  return -1
}
