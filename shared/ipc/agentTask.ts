// 서브에이전트 작업 (agent_task_start / agent_task_end).
//
// 주 에이전트가 task 도구로 위임하면 서브에이전트가 돈다.
// 서브 레인 청크는 taskId 와 streamRole:'sub' 를 달고 오며,
// **최상위 메시지가 되지 않고 해당 작업 안에 접혀야 한다** —
// 안 그러면 주 에이전트 대화에 서브 작업 텍스트가 섞여 뒤죽박죽이 된다.

export type AgentTaskStatus = 'running' | 'success' | 'failed'

export interface AgentTaskStep {
  /** 서브에이전트가 부른 도구 */
  toolName: string
  toolCallId?: string
  done: boolean
  failed?: boolean
}

export interface AgentTask {
  taskId: string
  /** 이 작업을 띄운 턴. 없으면 어느 턴에 붙일지 알 수 없다. */
  turnId?: string
  agentName: string
  description: string
  status: AgentTaskStatus
  /** 서브에이전트가 낸 텍스트를 이어붙인 것 */
  text: string
  steps: AgentTaskStep[]
  /** 초 단위. 런타임이 종료 시 알려준다. */
  durationSec?: number
  error?: string
}

export function taskStatusLabel(task: AgentTask): string {
  if (task.status === 'running') return '진행 중'
  return task.status === 'failed' ? '실패' : '완료'
}
