import { useEffect, useRef, useState } from 'react'
import { displayDuration } from '../utils/formatDuration'

// 턴 헤더 (설계 §6.2). vscode TurnContainer 헤더부(MessageList.tsx:31-131)와 동형.
//
// 텍스트는 문자열 그대로 "AXGentic Code", 스텝은 "{n} step" (복수형 없음).
// stepCount 는 **body 에 들어간 렌더 노드 수**이지 도구 개수가 아니다 —
// 연속 도구 묶음은 1로 센다.

const AUTO_COLLAPSE_MS = 350
const TICK_MS = 1000

export interface TurnHeaderProps {
  turnId?: string
  /** body 에 들어간 노드 수. 0 이면 토글도 body 도 만들지 않는다. */
  stepCount: number
  durationMs?: number
  startedAt?: number
  isStreaming: boolean
  terminal: boolean
  expanded: boolean
  onToggle: (expanded: boolean) => void
}

export function TurnHeader({
  turnId,
  stepCount,
  durationMs,
  startedAt,
  isStreaming,
  terminal,
  expanded,
  onToggle,
}: TurnHeaderProps) {
  const hasToggle = stepCount > 0
  const canToggle = hasToggle && !isStreaming && terminal
  const tick = useElapsedTick(isStreaming && durationMs === undefined && startedAt !== undefined)

  const duration = displayDuration(durationMs, {
    isStreaming,
    ...(startedAt !== undefined ? { startedAt } : {}),
    now: tick,
  })

  const handleToggle = () => {
    if (canToggle) onToggle(!expanded)
  }

  const classes = ['cc-turn-header', 'cc-rail-start']
  if (!hasToggle) classes.push('cc-turn-header--no-toggle')
  if (canToggle) classes.push('cc-turn-header--clickable')

  return (
    <div
      className={classes.join(' ')}
      data-turn-id={turnId}
      {...(canToggle
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-expanded': expanded,
            onClick: handleToggle,
            onKeyDown: (event: React.KeyboardEvent) => {
              // Enter 와 Space 만 받는다
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleToggle()
              }
            },
          }
        : {})}
    >
      <span className="cc-turn-header-text">AXGentic Code</span>
      {hasToggle && <span className="cc-turn-header-meta">{stepCount} step</span>}
      {duration && <span className="cc-turn-header-meta">{duration}</span>}
      {hasToggle && (
        <button
          type="button"
          className={`cc-turn-toggle${expanded ? ' cc-turn-toggle--expanded' : ''}`}
          aria-expanded={expanded}
          title={expanded ? 'Collapse turn steps' : 'Expand turn steps'}
          onClick={(event) => {
            event.stopPropagation()
            handleToggle()
          }}
        >
          <span className="cc-turn-toggle-icon">&gt;</span>
        </button>
      )}
    </div>
  )
}

/** 스트리밍 중일 때만 1초마다 다시 그린다 */
function useElapsedTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [active])

  return now
}

/**
 * 자동 접힘 (설계 §6.2).
 * 스트리밍 중이거나 아직 안 끝났으면 강제로 펼친다.
 * 사용자가 직접 토글한 적이 있으면 그 선택이 이긴다.
 */
export function useAutoCollapse(isStreaming: boolean, terminal: boolean) {
  const [expanded, setExpanded] = useState(true)
  const manuallyTouched = useRef(false)

  useEffect(() => {
    if (isStreaming || !terminal) {
      setExpanded(true)
      manuallyTouched.current = false
      return
    }
    if (manuallyTouched.current) return

    const timer = setTimeout(() => setExpanded(false), AUTO_COLLAPSE_MS)
    return () => clearTimeout(timer)
  }, [isStreaming, terminal])

  const toggle = (next: boolean) => {
    manuallyTouched.current = true
    setExpanded(next)
  }

  return { expanded, toggle }
}
