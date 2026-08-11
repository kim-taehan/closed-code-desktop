import type { ChatHistoryEntry } from '../../shared/protocol/chatHistory'

// 채팅 이력 목록 자체. 드롭다운과 사이드바가 같이 쓴다 —
// 같은 목록을 두 번 그리면 한쪽만 고쳐져 어긋난다.

export interface HistoryListProps {
  entries: ChatHistoryEntry[]
  loading: boolean
  /** 새 대화를 시작할 수 없는 상태(연결 전·응답 중) */
  newChatDisabled?: boolean
  onNewChat: () => void
  onSelect: (chatId: string) => void
  onRemove: (chatId: string) => void
}

export function HistoryList({
  entries,
  loading,
  newChatDisabled = false,
  onNewChat,
  onSelect,
  onRemove,
}: HistoryListProps) {
  return (
    <>
      {/* 목록이 있는 자리가 새 대화를 시작할 자리다 */}
      <button
        type="button"
        className="history-new"
        onClick={onNewChat}
        disabled={newChatDisabled}
      >
        + 새 대화
      </button>

      {loading && <div className="history-empty">불러오는 중…</div>}
      {!loading && entries.length === 0 && (
        <div className="history-empty">저장된 대화가 없습니다</div>
      )}

      {entries.map((entry) => (
        <div key={entry.chatId} className="history-item">
          <button type="button" className="history-item-main" onClick={() => onSelect(entry.chatId)}>
            <span className="history-item-title">{entry.title}</span>
            <span className="history-item-meta">{describeEntry(entry)}</span>
          </button>
          <button
            type="button"
            className="history-item-remove"
            title="삭제"
            onClick={(event) => {
              event.stopPropagation()
              onRemove(entry.chatId)
            }}
          >
            ×
          </button>
        </div>
      ))}
    </>
  )
}

/** 목록 항목의 부가 설명. 없는 값은 조용히 뺀다. */
function describeEntry(entry: ChatHistoryEntry): string {
  const parts: string[] = []
  if (entry.messageCount !== undefined) parts.push(`${entry.messageCount}턴`)
  const when = entry.updatedAt ?? entry.createdAt
  if (when) parts.push(formatDate(when))
  return parts.join(' · ')
}

function formatDate(iso: string): string {
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return ''
  const date = new Date(parsed)
  return `${date.getMonth() + 1}/${date.getDate()}`
}
