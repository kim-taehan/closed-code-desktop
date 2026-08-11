import { useState } from 'react'
import type { ToolResult } from '../../shared/ipc/messageTypes'
import { buildToolResultRows, isExpandable, prepareForRender } from '../utils/toolResultRows'

// IN / OUT / ERR 행 (설계 §6.6).
//
// IN 행은 bash·run_command 에만 있고, **DOM 에는 항상 있되 display 로 숨긴다.**
// OUT/ERR 블록은 펼쳤을 때만 실제로 붙는다. 둘의 동작이 다르다.

export interface ToolInRowProps {
  content: string | null
  expanded: boolean
}

export function ToolInRow({ content, expanded }: ToolInRowProps) {
  if (content === null) return null

  return (
    <div className="taz-io-block" style={expanded ? undefined : { display: 'none' }}>
      <div className="taz-io-row">
        <span className="taz-io-label">IN</span>
        <span className="taz-io-content taz-io-content--scroll">{content}</span>
      </div>
    </div>
  )
}

export interface ToolOutRowsProps {
  result: ToolResult | undefined
  toolName: string
}

export function ToolOutRows({ result, toolName }: ToolOutRowsProps) {
  const rows = buildToolResultRows(result)
  if (rows.length === 0) return null

  const isRunCommand = toolName.toLowerCase() === 'run_command'
  const failed = Boolean(result?.error)

  return (
    <div className="taz-io-block">
      {rows.map((row) => (
        <ExpandableRow key={row.label} label={row.label} content={row.content} isError={row.isError} />
      ))}
      {isRunCommand && (
        <div className={`taz-result-note${failed ? ' taz-result-note--error' : ''}`}>
          {failed ? '이 결과는 AI에 전달되지 않았습니다.' : '이 결과가 AI에 전달되었습니다.'}
        </div>
      )}
    </div>
  )
}

interface ExpandableRowProps {
  label: string
  content: string
  isError?: boolean
}

function ExpandableRow({ label, content, isError }: ExpandableRowProps) {
  const [expanded, setExpanded] = useState(false)
  // 잘라내기와 경로 정리를 먼저 하고 나서 펼침 여부를 판단한다
  const prepared = prepareForRender(content)
  const expandable = isExpandable(prepared)

  const classes = ['taz-io-content', 'taz-io-content--scroll']
  if (expandable) {
    classes.push('taz-io-content--collapsible')
    classes.push(expanded ? 'taz-io-content--expanded' : 'taz-io-content--collapsed')
  }
  if (isError) classes.push('taz-io-error')

  return (
    <div className="taz-io-row">
      <span className={`taz-io-label${isError ? ' taz-io-label--error' : ''}`}>{label}</span>
      <span className={classes.join(' ')}>{prepared}</span>
      {expandable && (
        <button
          type="button"
          className="taz-io-toggle"
          onClick={(event) => {
            event.stopPropagation()
            setExpanded((previous) => !previous)
          }}
        >
          {expanded ? '▲ Show less' : '▼ Show more'}
        </button>
      )}
    </div>
  )
}
