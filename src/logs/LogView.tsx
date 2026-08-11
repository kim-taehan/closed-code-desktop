import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from '../../shared/ipc/logPayloads'
import { LogToolbar, type LogView as ViewMode } from './LogToolbar'

// 로그 화면. **채팅과 같은 자리**를 쓴다 — 탭도 창도 늘리지 않는다.
//
// 세그먼트로 한 줄기씩 보되 `같이 보기` 는 시간순으로 섞는다 —
// "내가 뭘 보냈는데 저쪽이 뭐라 했나" 를 맞춰볼 때가 로그를 여는 대부분의 이유다.

export function LogView() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [view, setView] = useState<ViewMode>('both')
  const [follow, setFollow] = useState(true)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.davis.listLogs().then((result) => setEntries(result.entries))
    return window.davis.onLogAppend((entry) => setEntries((current) => [...current, entry]))
  }, [])

  const shown = entries.filter((entry) => view === 'both' || entry.source === view)

  // 새 줄이 붙으면 바닥으로 따라간다. 위로 올려 읽는 중이면 방해하지 않는다.
  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView()
  }, [shown.length, follow])

  return (
    <div className="log-window">
      <LogToolbar
        view={view}
        onView={setView}
        follow={follow}
        onFollow={setFollow}
        onClear={() => {
          void window.davis.clearLogs()
          setEntries([])
        }}
        onCopy={() => void navigator.clipboard.writeText(shown.map(toText).join('\n'))}
      />

      <div className="log-window__body">
        {shown.length === 0 ? (
          <p className="log-window__empty">{emptyReason(view)}</p>
        ) : (
          shown.map((entry) => (
            <div key={entry.seq} className={`log-line log-line--${entry.source}`}>
              <span className="log-line__at">{clock(entry.at)}</span>
              {view === 'both' && (
                <span className="log-line__source">
                  {entry.source === 'runtime' ? '런타임' : '데스크탑'}
                </span>
              )}
              <span className="log-line__text">{entry.text}</span>
            </div>
          ))
        )}
        <div ref={bottom} />
      </div>
    </div>
  )
}

/**
 * 비어 있는 이유를 짚어준다.
 *
 * 런타임을 우리가 띄우지 않았으면 그 프로세스의 출력은 우리 것이 아니라 받을 수 없다.
 * 빈 화면만 두면 고장으로 오해한다.
 */
function emptyReason(view: ViewMode): string {
  if (view === 'runtime') {
    return '런타임 출력이 없습니다. 이미 떠 있던 런타임에 붙었다면 그 프로세스의 출력은 받을 수 없습니다.'
  }
  return '아직 쌓인 로그가 없습니다.'
}

function clock(at: number): string {
  const date = new Date(at)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

function toText(entry: LogEntry): string {
  return `${clock(entry.at)}  ${entry.source === 'runtime' ? '런타임' : '데스크탑'}  ${entry.text}`
}
