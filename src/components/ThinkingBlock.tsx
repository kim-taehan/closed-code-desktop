import { useState } from 'react'

// 추론(reasoning) 블록 (DC-1029/1030).
//
// 런타임이 추론 토큰을 답변과 분리해 보낸다 (domains/chat.py:141-147).
// **기본은 접힘** — 추론이 길어도 최종 답변이 묻히지 않아야 한다.
//
// 마크다운으로 파싱하지 않는다. 스트리밍 중에는 코드펜스·표가 열린 채로 도착해
// 파서가 남은 본문을 통째로 삼키는 구간이 생긴다. 추론은 읽을 수만 있으면 된다.

export interface ThinkingBlockProps {
  content: string
  railEnd?: boolean
}

export function ThinkingBlock({ content, railEnd = false }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`thinking-block${railEnd ? ' cc-rail-end' : ''}`}>
      <button
        type="button"
        className="thinking-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="thinking-toggle-icon">{expanded ? '▼' : '▶'}</span>
        <span className="thinking-toggle-text">추론</span>
      </button>

      {expanded && <div className="thinking-body">{content}</div>}
    </div>
  )
}
