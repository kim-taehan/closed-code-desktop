import { useState } from 'react'
import { taskStatusLabel, type AgentTask } from '../../shared/ipc/agentTask'
import { formatDuration } from '../utils/formatDuration'

// 서브에이전트 작업 카드.
//
// 주 에이전트가 task 로 위임하면 서브에이전트가 따로 돈다.
// 그 안의 텍스트·도구는 주 대화에 섞이지 않고 여기 접힌다 —
// 섞이면 누가 무슨 말을 했는지 알 수 없게 된다.

export interface AgentTaskCardProps {
  task: AgentTask
  railEnd?: boolean
}

export function AgentTaskCard({ task, railEnd = false }: AgentTaskCardProps) {
  // 진행 중에는 펼쳐 두고, 끝나면 접는다 — 도구 묶음과 같은 규칙
  const [manuallyToggled, setManuallyToggled] = useState<boolean | null>(null)
  const expanded = manuallyToggled ?? task.status === 'running'

  const duration = task.durationSec !== undefined ? formatDuration(task.durationSec * 1000) : null
  const doneSteps = task.steps.filter((step) => step.done).length

  return (
    <div className={`agent-task agent-task--${task.status}${railEnd ? ' cc-rail-end' : ''}`}>
      <div className="agent-task-head" onClick={() => setManuallyToggled(!expanded)}>
        <span className="agent-task-icon">{expanded ? '▼' : '▶'}</span>
        <span className="agent-task-name">{task.agentName}</span>
        {task.description && <span className="agent-task-desc">{task.description}</span>}
        <span className="agent-task-status">{taskStatusLabel(task)}</span>
        {task.steps.length > 0 && (
          <span className="agent-task-steps">
            {doneSteps}/{task.steps.length}
          </span>
        )}
        {duration && <span className="agent-task-time">{duration}</span>}
      </div>

      {expanded && (
        <div className="agent-task-body">
          {task.steps.length > 0 && (
            <ul className="agent-task-tools">
              {task.steps.map((step, index) => (
                <li
                  key={step.toolCallId ?? `${step.toolName}-${index}`}
                  className={`agent-task-tool${step.failed ? ' agent-task-tool--failed' : ''}`}
                >
                  <span className={`taz-dot taz-dot-${step.failed ? 'error' : step.done ? 'success' : 'running'}`} />
                  {step.toolName}
                </li>
              ))}
            </ul>
          )}
          {task.text && <div className="agent-task-text">{task.text}</div>}
          {task.error && <div className="agent-task-error">{task.error}</div>}
        </div>
      )}
    </div>
  )
}
