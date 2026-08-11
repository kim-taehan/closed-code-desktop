import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchMatchPayload } from '../../shared/ipc/channels'

// 내용 검색 (Cmd/Ctrl + Shift + F).
//
// 치는 대로 찾되 **잠깐 멈췄을 때만** 돈다 (디바운스).
// 파일을 전부 읽는 일이라 글자마다 돌리면 큰 저장소에서 앱이 멈춘다.
//
// 늦게 도착한 옛 응답은 버린다 — 'ab' 결과가 'abc' 결과를 덮으면
// 지금 친 것과 다른 목록을 보게 된다.

export interface SearchPanelProps {
  onOpen: (path: string) => void
  onClose: () => void
}

type State =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; matches: SearchMatchPayload[]; truncated: boolean }

/** 이보다 짧으면 결과가 너무 많아 쓸모없다 */
const MIN_QUERY = 2
/** 이만큼 멈추면 찾는다. 짧으면 글자마다 도는 것과 다르지 않다. */
const DEBOUNCE_MS = 300

export function SearchPanel({ onOpen, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<State>({ status: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  /** 마지막으로 보낸 요청. 늦게 온 옛 응답을 버리는 데 쓴다. */
  const latest = useRef(0)

  useEffect(() => inputRef.current?.focus(), [])

  const run = useCallback(async (text: string) => {
    const needle = text.trim()
    if (needle.length < MIN_QUERY) {
      setState({ status: 'idle' })
      return
    }

    const ticket = ++latest.current
    setState({ status: 'searching' })
    const result = await window.davis.searchText({ query: needle })

    // 그 사이 더 친 글자가 있으면 이 결과는 옛것이다
    if (ticket !== latest.current) return
    setState({ status: 'done', matches: result.matches, truncated: result.truncated })
  }, [])

  // 잠깐 멈췄을 때만 찾는다
  useEffect(() => {
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, run])

  return (
    <div className="dc-modal" role="dialog" aria-label="검색어 찾기" onClick={onClose}>
      <div className="dc-palette dc-palette--wide" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="dc-palette__input"
          value={query}
          placeholder="찾을 내용"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
            // 기다리지 않고 지금 찾고 싶을 때
            if (event.key === 'Enter') void run(query)
          }}
          aria-label="찾을 내용"
        />

        {state.status === 'idle' && (
          <div className="dc-palette__empty">
            {query.trim() === '' ? '찾을 내용을 입력하세요' : `${MIN_QUERY}글자 이상 입력하세요`}
          </div>
        )}
        {state.status === 'searching' && <div className="dc-palette__empty">찾는 중…</div>}

        {state.status === 'done' && state.matches.length === 0 && (
          <div className="dc-palette__empty">찾지 못했습니다</div>
        )}

        {state.status === 'done' && state.matches.length > 0 && (
          <>
            <div className="dc-palette__note">{state.matches.length}곳</div>
            <ul className="dc-palette__list">
              {state.matches.map((match, index) => (
                <li key={`${match.file}-${match.line}-${index}`}>
                  <button
                    type="button"
                    className="dc-palette__item"
                    onClick={() => {
                      onOpen(match.file)
                      onClose()
                    }}
                  >
                    <span className="dc-palette__where">
                      {match.file}
                      <span className="dc-palette__line">:{match.line}</span>
                    </span>
                    <span className="dc-palette__preview">{match.preview}</span>
                  </button>
                </li>
              ))}
            </ul>
            {/* 잘렸다는 사실을 감추지 않는다 */}
            {state.truncated && (
              <div className="dc-palette__note">결과가 많아 일부만 보여줍니다</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
