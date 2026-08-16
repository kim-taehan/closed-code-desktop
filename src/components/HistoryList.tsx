import { useEffect, useRef, useState } from 'react'
import type { ChatHistoryEntry } from '../../shared/protocol/chatHistory'

// 채팅 이력 목록 자체. 드롭다운과 사이드바가 같이 쓴다 —
// 같은 목록을 두 번 그리면 한쪽만 고쳐져 어긋난다.
//
// **검색은 서버가 한다.** `entries` 를 여기서 걸러 내지 않는다 — opencode 의
// `GET /session?search=` 이 제목으로 거르고(실측 성질은 `electron/opencode/historyApi.ts`),
// 화면이 또 거르면 같은 낱말에 두 판정이 생긴다. 여기가 하는 일은 **입력을 모아 한 번씩
// 물어보는 것**뿐이다.
//
// **말 한 번 안 걸린 대화는 접어 둔다.** 접히는 근거는 제목이 아니라 **센 결과**다 —
// 어댑터가 메시지를 실제로 세어 0건인 것에만 `message_count: 0` 을 싣는다
// (`electron/opencode/emptyChats.ts`). 그래서 여기서는 `messageCount === 0` 하나만 본다:
// 못 센 대화는 `undefined` 로 와 **접히지 않는다.** 접은 개수와 그 근거("메시지 0건")는
// 늘 줄로 보이고 한 번 눌러 펼 수 있다 — 조용히 사라지지 않는다.

/** 입력을 이만큼 쉬면 서버에 묻는다. 글자마다 묻지 않으려는 것뿐이다. */
const SEARCH_DELAY_MS = 250

export interface HistoryListProps {
  entries: ChatHistoryEntry[]
  loading: boolean
  /** 새 대화를 시작할 수 없는 상태(연결 전·응답 중) */
  newChatDisabled?: boolean
  onNewChat: () => void
  onSelect: (chatId: string) => void
  onRemove: (chatId: string) => void
  /** 검색어가 멎으면 부른다. 빈 문자열이면 전체를 다시 받는다는 뜻이다. */
  onSearch: (query: string) => void
}

export function HistoryList({
  entries,
  loading,
  newChatDisabled = false,
  onNewChat,
  onSelect,
  onRemove,
  onSearch,
}: HistoryListProps) {
  const [query, setQuery] = useState('')
  const [showEmpty, setShowEmpty] = useState(false)

  // 콜백을 ref 로 든다 — 부르는 쪽이 인라인 화살표를 넘기면 렌더마다 신원이 바뀌어,
  // 의존성에 넣는 순간 타이머가 렌더마다 처음부터 다시 돈다(= 입력 중엔 영영 안 나간다).
  const search = useRef(onSearch)
  search.current = onSearch
  // 처음 뜰 때는 묻지 않는다 — 패널을 여는 쪽이 이미 목록을 물었다 (`ProjectSidebar`)
  const typed = useRef(false)

  useEffect(() => {
    if (!typed.current) return
    const timer = setTimeout(() => search.current(query), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query])

  const empty = entries.filter(isEmptyChat)
  const visible = showEmpty ? entries : entries.filter((entry) => !isEmptyChat(entry))

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

      <input
        className="history-search"
        type="search"
        value={query}
        placeholder="대화 제목 검색"
        aria-label="대화 제목 검색"
        onChange={(event) => {
          typed.current = true
          setQuery(event.target.value)
        }}
      />

      {loading && <div className="history-empty">불러오는 중…</div>}
      {!loading && entries.length === 0 && (
        <div className="history-empty">{query ? '검색 결과가 없습니다' : '저장된 대화가 없습니다'}</div>
      )}

      {visible.map((entry) => (
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

      {/* 접은 것이 있으면 **몇 개를 무슨 근거로** 접었는지 늘 말한다 */}
      {empty.length > 0 && (
        <button type="button" className="history-folded" onClick={() => setShowEmpty(!showEmpty)}>
          메시지 0건인 대화 {empty.length}개 {showEmpty ? '접기' : '보기'}
        </button>
      )}
    </>
  )
}

/** 어댑터가 **세어 확인한** 빈 대화만 0 을 싣는다 — `undefined` 는 「모른다」다 (머리말). */
function isEmptyChat(entry: ChatHistoryEntry): boolean {
  return entry.messageCount === 0
}

/** 목록 항목의 부가 설명. 없는 값은 조용히 뺀다. */
function describeEntry(entry: ChatHistoryEntry): string {
  const parts: string[] = []
  // 0 은 "0턴" 이 아니라 **빈 대화**로 말한다 — 접기 줄과 같은 낱말이라야 짝이 보인다
  if (entry.messageCount === 0) parts.push('빈 대화')
  else if (entry.messageCount !== undefined) parts.push(`${entry.messageCount}턴`)
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
