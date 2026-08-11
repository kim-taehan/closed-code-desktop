import { useEffect, useState } from 'react'
import type { ChatMessage } from '../../shared/ipc/messageTypes'
import { formatDuration } from '../utils/formatDuration'
import { buildToolChipLabel, buildToolInContent } from '../utils/buildToolDesc'
import { ToolIcon, toolStatusOf } from './ToolIcon'
import { ToolInRow, ToolOutRows } from './ToolResultRows'

// 도구 행 하나 (설계 §6.6). 기본은 접힌 상태다.

const TICK_MS = 1000

export interface ToolCallRowProps {
  message: ChatMessage
  /** 도구 인자. 청크에서 온 원본을 그대로 넘긴다. */
  args?: unknown
}

export function ToolCallRow({ message, args }: ToolCallRowProps) {
  const [expanded, setExpanded] = useState(false)
  const toolName = message.toolName ?? '알 수 없는 도구'
  const status = toolStatusOf(message.toolResult)
  const hasResult = Boolean(message.toolResult)

  const elapsed = useToolElapsed(message.timestamp, hasResult)
  const chipLabel = buildToolChipLabel(toolName, args)
  const inContent = buildToolInContent(toolName, args)

  return (
    <div className="taz-item">
      <div className="taz-header" onClick={() => setExpanded((previous) => !previous)}>
        <ToolIcon toolName={toolName} status={status} />
        <span className="taz-tool-name">{toolName}</span>
        {chipLabel && <span className="taz-desc">{chipLabel}</span>}
        {elapsed && <span className="taz-time">{elapsed}</span>}
      </div>

      <ToolInRow content={inContent} expanded={expanded} />
      {expanded && hasResult && <ToolOutRows result={message.toolResult} toolName={toolName} />}
    </div>
  )
}

/**
 * 도구 경과시간.
 * 결과가 도착하면 **그 시점에 한 번 계산하고 고정한다** — 이후 틱은 돌지 않는다.
 * (vscode 도 같은 동작이며, 실제 도구 소요와는 다를 수 있다.)
 */
function useToolElapsed(timestamp: string | undefined, hasResult: boolean): string | null {
  const [elapsed, setElapsed] = useState<string | null>(() => computeElapsed(timestamp))

  useEffect(() => {
    if (!timestamp) return
    if (hasResult) {
      setElapsed(computeElapsed(timestamp))
      return
    }
    const timer = setInterval(() => setElapsed(computeElapsed(timestamp)), TICK_MS)
    return () => clearInterval(timer)
  }, [timestamp, hasResult])

  return elapsed
}

function computeElapsed(timestamp: string | undefined): string | null {
  if (!timestamp) return null
  const started = Date.parse(timestamp)
  if (!Number.isFinite(started)) return null
  return formatDuration(Date.now() - started)
}
