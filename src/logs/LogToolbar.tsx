// 로그 창 위쪽 줄.
//
// **탭이 아니라 세그먼트 버튼**이다. 앱에 이미 탭이 많아 또 탭처럼 생기면
// 어느 층의 탭인지 헷갈린다. 붙어 있는 세 칸이라 한 줄만 먹는다.

export type LogView = 'runtime' | 'desktop' | 'both'

const SEGMENTS: Array<{ value: LogView; label: string }> = [
  { value: 'runtime', label: '런타임' },
  { value: 'desktop', label: '데스크탑' },
  { value: 'both', label: '같이 보기' },
]

export interface LogToolbarProps {
  view: LogView
  onView: (view: LogView) => void
  follow: boolean
  onFollow: (follow: boolean) => void
  onClear: () => void
  onCopy: () => void
}

export function LogToolbar(props: LogToolbarProps) {
  return (
    <div className="log-bar">
      <div className="log-seg" role="group" aria-label="로그 종류">
        {SEGMENTS.map((segment) => (
          <button
            key={segment.value}
            type="button"
            className={`log-seg__item${props.view === segment.value ? ' log-seg__item--on' : ''}`}
            aria-pressed={props.view === segment.value}
            onClick={() => props.onView(segment.value)}
          >
            {segment.label}
          </button>
        ))}
      </div>

      <div className="log-bar__right">
        <label className="log-bar__follow">
          <input
            type="checkbox"
            checked={props.follow}
            onChange={(event) => props.onFollow(event.target.checked)}
          />
          자동 따라가기
        </label>
        <button type="button" className="log-bar__action" onClick={props.onCopy}>
          복사
        </button>
        <button type="button" className="log-bar__action" onClick={props.onClear}>
          지움
        </button>
      </div>
    </div>
  )
}
