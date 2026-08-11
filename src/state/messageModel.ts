import { MessageKind, type ChatMessage } from '../../shared/ipc/messageTypes'

// 모델 자체는 shared 에 있다 (main 이 조립하고 renderer 가 렌더하므로).
// 여기에는 renderer 의 렌더 판정 헬퍼만 둔다.

export { MessageKind } from '../../shared/ipc/messageTypes'
export type { ChatMessage, MessageKind as MessageKindType, ToolResult, TurnMeta } from '../../shared/ipc/messageTypes'

/** 내용이 있는가. 빈 TEXT 는 렌더 대상이 아니다 (MessageList.tsx:293, :312) */
export function hasContent(message: ChatMessage): boolean {
  return message.content.trim().length > 0
}

/** 턴 안에서 렌더될 수 있는 종류인가 (MessageList.tsx:419) */
export function isRenderableKind(kind: MessageKind): boolean {
  return (
    kind === MessageKind.TEXT ||
    kind === MessageKind.THINKING ||
    kind === MessageKind.TOOL_CALL ||
    kind === MessageKind.ERROR ||
    kind === MessageKind.AGENT_TASK_START ||
    kind === MessageKind.CODE_DIFF
  )
}
