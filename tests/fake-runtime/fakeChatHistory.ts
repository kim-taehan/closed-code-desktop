import { Action, Kind } from '../../shared/protocol/kinds'
import type { ServerFrame } from './turnScript'

// 가짜 서버의 채팅 이력 도메인.
//
// ⚠️ 이 도메인은 요청·응답 모두 **snake_case 가 정본이다** (별칭 없음).
// camelCase 로 오면 chat_id 를 못 찾아 실패하는 것까지 재현한다 —
// 하네스가 실제보다 관대하면 테스트가 통과해도 의미가 없다.

export interface ChatHistoryReplyInput {
  action: string
  reqId: string
  data?: Record<string, unknown>
  /** 서버가 들고 있는 목록 (호출자가 소유. 삭제·이름변경은 여기서 직접 고친다) */
  history: Record<string, unknown>[]
  onHistoryLoad?: (chatId: string) => ServerFrame[]
}

export function buildChatHistoryReply(input: ChatHistoryReplyInput): ServerFrame[] {
  const { action, reqId, data, history } = input

  if (action === Action.CHAT_HISTORY_LIST) {
    return [
      { kind: Kind.CHAT_HISTORY, action: Action.CHAT_HISTORY_LIST, replyTo: reqId, data: { chats: history } },
    ]
  }

  const chatId = data?.['chat_id']
  if (typeof chatId !== 'string') {
    return [
      {
        kind: Kind.CHAT_HISTORY,
        action: Action.ERROR,
        replyTo: reqId,
        data: { code: 'BAD_REQUEST', message: 'chat_id 필수 (snake_case)' },
      },
    ]
  }

  if (action === Action.CHAT_HISTORY_LOAD) {
    // 실제 runtime 은 지난 프레임을 다시 흘려보낸 뒤 완료를 알린다
    return [
      ...(input.onHistoryLoad?.(chatId) ?? []),
      {
        kind: Kind.CHAT_HISTORY,
        action: Action.CHAT_HISTORY_LOAD_COMPLETE,
        replyTo: reqId,
        data: { state: 'ok', message: '완료', chat_id: chatId },
      },
    ]
  }

  if (action === Action.CHAT_HISTORY_REMOVE) {
    const index = history.findIndex((entry) => entry['chat_id'] === chatId)
    if (index >= 0) history.splice(index, 1)
    return [
      {
        kind: Kind.CHAT_HISTORY,
        action: Action.CHAT_HISTORY_REMOVE,
        replyTo: reqId,
        data: { state: 'ok', message: '삭제됨', chat_id: chatId },
      },
    ]
  }

  if (action === Action.CHAT_HISTORY_RENAME) {
    const title = String(data?.['title'] ?? '')
    const entry = history.find((item) => item['chat_id'] === chatId)
    if (entry) entry['title'] = title
    return [
      { kind: Kind.CHAT_HISTORY, action: Action.CHAT_HISTORY_TITLE, replyTo: reqId, data: { chat_id: chatId, title } },
    ]
  }

  return []
}
