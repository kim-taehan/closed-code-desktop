// 채팅 이력 계약 (domains/chat_history.py).
//
// ⚠️ 이 도메인은 **snake_case 가 정본이다.** chat 도메인과 반대다 —
// ChatHistoryData 에는 별칭이 걸려 있지 않다. camelCase 로 보내면 조용히 무시된다.

export interface ChatHistoryEntry {
  chatId: string
  title: string
  createdAt?: string
  updatedAt?: string
  messageCount?: number
  /** completed / interrupted / error */
  status?: string
}

/** 서버가 주는 원본(snake_case)을 화면이 쓰는 모양으로 바꾼다 */
export function toHistoryEntry(raw: unknown): ChatHistoryEntry | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>

  const chatId = record['chat_id']
  if (typeof chatId !== 'string' || !chatId) return null

  const entry: ChatHistoryEntry = {
    chatId,
    title: typeof record['title'] === 'string' && record['title'] ? record['title'] : `대화 ${chatId.slice(0, 8)}`,
  }
  if (typeof record['created_at'] === 'string') entry.createdAt = record['created_at']
  if (typeof record['updated_at'] === 'string') entry.updatedAt = record['updated_at']
  if (typeof record['message_count'] === 'number') entry.messageCount = record['message_count']
  if (typeof record['status'] === 'string') entry.status = record['status']
  return entry
}

/** chat_history_list 응답에서 목록을 뽑는다 */
export function parseHistoryList(data: unknown): ChatHistoryEntry[] {
  if (data === null || typeof data !== 'object') return []
  const chats = (data as Record<string, unknown>)['chats']
  if (!Array.isArray(chats)) return []

  return chats.map(toHistoryEntry).filter((entry): entry is ChatHistoryEntry => entry !== null)
}

export interface HistoryStateResult {
  state: string
  message: string
  chatId: string
}

/** chat_history_add / remove / load_complete 응답 */
export function parseHistoryState(data: unknown): HistoryStateResult | null {
  if (data === null || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const chatId = record['chat_id']
  if (typeof chatId !== 'string') return null

  return {
    state: typeof record['state'] === 'string' ? record['state'] : '',
    message: typeof record['message'] === 'string' ? record['message'] : '',
    chatId,
  }
}
