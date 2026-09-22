import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyMatch } from '../state/fuzzy'
import { hasWildcard, likeMatch } from '../state/likeMatch'

// 빠른 열기 (Cmd/Ctrl + P).
//
// 트리를 펼쳐 내려가는 것보다 빠르다. 목록은 열 때 한 번만 받아 온다 —
// 글자를 칠 때마다 다시 훑으면 큰 저장소에서 멈춘다.
//
// 좁히는 법은 둘이고 **쿼리가 고른다**: `*`·`?` 가 있으면 like(`likeMatch`),
// 없으면 종전 퍼지(`fuzzy`). 퍼지를 like 로 갈아치우지 않는 이유는 짧은 약어로 찾는
// 주 경로가 퍼지이기 때문이다 (`apps` → `App.tsx`). (davis-code-desktop `0d2bc59` 에서 가져왔다)

const MAX_SHOWN = 40

export interface QuickOpenProps {
  onOpen: (path: string) => void
  onClose: () => void
}

export function QuickOpen({ onOpen, onClose }: QuickOpenProps) {
  const [files, setFiles] = useState<string[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void window.davis.listFiles().then((result) => {
      setFiles(result.files)
      setTruncated(result.truncated)
    })
  }, [])

  const hits = useMemo(() => {
    if (files === null) return []
    const q = query.trim()
    if (q === '') return files.slice(0, MAX_SHOWN)

    return files
      .map((file) => ({ file, score: scoreOf(q, file) }))
      .filter((entry) => entry.score !== null)
      .sort((a, b) => b.score! - a.score!)
      .slice(0, MAX_SHOWN)
      .map((entry) => entry.file)
  }, [files, query])

  // 목록이 바뀌면 커서를 맨 위로 — 안 그러면 엉뚱한 파일이 열린다
  useEffect(() => setCursor(0), [query])

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') return onClose()
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((value) => Math.min(value + 1, hits.length - 1))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((value) => Math.max(value - 1, 0))
    }
    if (event.key === 'Enter') {
      const picked = hits[cursor]
      if (picked) {
        onOpen(picked)
        onClose()
      }
    }
  }

  return (
    <div className="dc-modal" role="dialog" aria-label="파일 찾기" onClick={onClose}>
      <div className="dc-palette" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="dc-palette__input"
          value={query}
          placeholder="파일 이름"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label="파일 이름"
        />

        {files === null ? (
          <div className="dc-palette__empty">파일을 훑는 중…</div>
        ) : hits.length === 0 ? (
          <div className="dc-palette__empty">맞는 파일이 없습니다</div>
        ) : (
          <ul className="dc-palette__list">
            {hits.map((file, index) => (
              <li key={file}>
                <button
                  type="button"
                  className={`dc-palette__item${index === cursor ? ' dc-palette__item--on' : ''}`}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => {
                    onOpen(file)
                    onClose()
                  }}
                >
                  <span className="dc-palette__name">{baseName(file)}</span>
                  <span className="dc-palette__path">{file}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* 잘렸다는 사실을 감추지 않는다 — 없는 줄 알면 다시 찾지 않는다 */}
        {truncated && <div className="dc-palette__note">파일이 너무 많아 일부만 훑었습니다</div>}
      </div>
    </div>
  )
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

/** 안 맞으면 null. 와일드카드가 있으면 like, 없으면 퍼지 점수. */
function scoreOf(query: string, file: string): number | null {
  if (hasWildcard(query)) return likeMatch(query, file)
  return fuzzyMatch(query, file)?.score ?? null
}
