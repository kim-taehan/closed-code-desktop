import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../shared/ipc/messageTypes'
import { completedToolCount, hasRunningTool } from '../state/turnNodes'
import { formatDuration } from '../utils/formatDuration'
import { ToolCallRow } from './ToolCallRow'

// 연속한 도구 묶음 (설계 §6.5).
//
// 하나면 카운터 없이 항상 보이고, 둘 이상이면 카운터 행으로 접힌다.
// 자동 접힘은 **다음 노드가 비도구일 때만** 일어난다 —
// 턴 마지막의 도구 묶음은 펼친 채로 남는다.

const AUTO_COLLAPSE_MS = 350
const TICK_MS = 1000

export interface TazAreaProps {
  tools: ChatMessage[]
  /** 도구 인자 조회. messageStore 는 인자를 보관하지 않으므로 밖에서 넘긴다. */
  argsOf?: (message: ChatMessage) => unknown
  /** 이 묶음 다음 노드가 도구가 아닌가 — 자동 접힘 조건 */
  collapseWhenFollowedByNonTool?: boolean
  railEnd?: boolean
}

export function TazArea({
  tools,
  argsOf,
  collapseWhenFollowedByNonTool = false,
  railEnd = false,
}: TazAreaProps) {
  const running = hasRunningTool(tools)
  const elapsed = useGroupElapsed(tools, running)
  const { showTools, toggle } = useGroupExpansion(running, collapseWhenFollowedByNonTool)

  if (tools.length === 0) return null

  const railClass = railEnd ? ' cc-rail-end' : ''

  // 도구가 하나면 카운터도 토글도 없다
  if (tools.length === 1) {
    return (
      <div className={`taz-area taz-area--single${railClass}`}>
        <div className="taz-current">
          <ToolCallRow message={tools[0]!} args={argsOf?.(tools[0]!)} />
        </div>
      </div>
    )
  }

  const counterText = running
    ? `${tools.length}개 작업 진행 중…`
    : `${completedToolCount(tools)}개 작업 완료`

  return (
    <div className={`taz-area taz-area--group${railClass}`}>
      <div className="taz-counter" onClick={toggle}>
        <span className="taz-counter-icon">{showTools ? '▼' : '▶'}</span>
        <span className="taz-counter-text">{counterText}</span>
        {elapsed && <span className="taz-counter-time">{elapsed}</span>}
      </div>
      {showTools && (
        <div className="taz-expanded taz-expanded-unified">
          {tools.map((tool) => (
            <ToolCallRow key={tool.id} message={tool} args={argsOf?.(tool)} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 묶음 경과시간.
 * 도구가 2개 미만이거나 첫 도구에 시각이 없으면 표시하지 않는다.
 * 진행이 끝나는 순간 **한 번 래치**되고, 다시 진행되면 풀린다.
 */
function useGroupElapsed(tools: ChatMessage[], running: boolean): string | null {
  const [endTime, setEndTime] = useState<number | null>(null)
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (running) {
      setEndTime(null)
      return
    }
    setEndTime((previous) => previous ?? Date.now())
  }, [running])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => forceTick((value) => value + 1), TICK_MS)
    return () => clearInterval(timer)
  }, [running])

  if (tools.length < 2) return null
  const startedAt = tools[0]?.timestamp
  if (!startedAt) return null

  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) return null

  return formatDuration((endTime ?? Date.now()) - started)
}

/**
 * 펼침 상태.
 * 진행 중이면 자동으로 펼치고, 끝나면 **다음 노드가 비도구일 때만** 350ms 뒤 접는다.
 * 수동 토글은 진행 중엔 무시된다.
 */
function useGroupExpansion(running: boolean, collapseWhenFollowedByNonTool: boolean) {
  const [autoExpanded, setAutoExpanded] = useState(false)
  const [manualExpanded, setManualExpanded] = useState(false)
  const showTools = running || autoExpanded || manualExpanded
  const showToolsRef = useRef(showTools)
  showToolsRef.current = showTools

  useEffect(() => {
    if (running) {
      setAutoExpanded(true)
      return
    }
    if (!collapseWhenFollowedByNonTool) return

    const timer = setTimeout(() => setAutoExpanded(false), AUTO_COLLAPSE_MS)
    return () => clearTimeout(timer)
  }, [running, collapseWhenFollowedByNonTool])

  const toggle = () => {
    if (running) return
    if (showToolsRef.current) {
      setManualExpanded(false)
      setAutoExpanded(false)
      return
    }
    setManualExpanded(true)
  }

  return { showTools, toggle }
}
