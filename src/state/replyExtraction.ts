import { MessageKind, hasContent, type ChatMessage } from './messageModel'

// 턴의 "답변"을 골라낸다 (설계 §6.4, vscode MessageList.tsx:369-394).
//
// reply 로 뽑힌 메시지는 접히는 body 바깥에 렌더된다.
// 그래야 중간 단계가 접혀도 최종 답변은 계속 보인다.

export interface ReplyContext {
  /** 턴이 끝났는가 (meta.terminal === true 또는 경계로 판단) */
  turnEnded: boolean
  /** 턴 안에 interrupted 메시지가 있는가 */
  turnInterrupted: boolean
}

/**
 * 규칙 (순서대로):
 *  1. semanticType === 'reply' 인 마지막 TEXT — **턴이 끝나지 않았어도** 이긴다
 *  2. 턴이 끝났다면 내용 있는 마지막 TEXT
 *  3. 그 외에는 없음
 *
 * 중단된 턴은 "있던 자리에 그대로 얼린다" — reply 를 뽑지 않는다.
 */
export function extractReply(
  messages: ChatMessage[],
  context: ReplyContext,
): ChatMessage | undefined {
  if (context.turnInterrupted) return undefined

  const semanticReply = findLast(
    messages,
    (message) =>
      message.kind === MessageKind.TEXT && message.semanticType === 'reply' && hasContent(message),
  )
  if (semanticReply) return semanticReply

  if (!context.turnEnded) return undefined

  return findLast(messages, (message) => message.kind === MessageKind.TEXT && hasContent(message))
}

/** 뒤에서부터 처음 맞는 것. vscode 가 reverse().find() 로 하는 것과 같다. */
function findLast(
  messages: ChatMessage[],
  predicate: (message: ChatMessage) => boolean,
): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (predicate(message)) return message
  }
  return undefined
}

/** 턴 안에 중단된 메시지가 있는가 (MessageList.tsx:365) */
export function isTurnInterrupted(messages: ChatMessage[]): boolean {
  return messages.some((message) => message.interrupted === true)
}
