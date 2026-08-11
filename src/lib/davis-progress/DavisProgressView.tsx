import { ProgressLogo } from './ProgressLogo'
import type { ProgressView } from './progressMachine'

// 상태 없는 표시부. 뷰 스냅샷 하나만 받아 그린다.
// 클래스 이름은 styles.css 와의 계약이므로 원본 문자열 그대로 유지한다.

export function DavisProgressView({ visible, mode, text, stalled }: ProgressView) {
  // 원본은 display:none 으로 숨겼지만 React 에서는 아예 렌더하지 않는다.
  // 표시기는 상태를 갖지 않으므로 DOM 을 남겨둘 이유가 없다.
  if (!visible) {
    return null
  }

  const className = `davis-progress davis-progress--${mode}${stalled ? ' davis-progress--stalled' : ''}`

  return (
    <div className={className}>
      <span className="davis-progress__glyph" role="status" aria-label="Processing indicator">
        <ProgressLogo />
      </span>
      <span className="davis-progress__verb">{text}</span>
    </div>
  )
}
