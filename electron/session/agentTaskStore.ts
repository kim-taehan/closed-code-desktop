import type { AgentTask, AgentTaskStep } from '../../shared/ipc/agentTask'

// 서브에이전트 작업 상태.
//
// 서브 레인 청크(taskId 보유)는 최상위 메시지가 되지 않고 여기 접힌다.
// 짝을 못 찾는 청크는 버린다 — 임의로 작업을 만들면 유령 작업이 생긴다.

export interface AgentTaskStartInput {
  taskId: string
  /** 이 작업이 시작된 턴 */
  turnId?: string
  agentName?: string
  description?: string
}

export interface AgentTaskEndInput {
  taskId: string
  success?: boolean
  error?: string
  durationSec?: number
}

export class AgentTaskStore {
  /** taskId → 작업. 순서를 유지하려고 Map 을 쓴다. */
  private tasks = new Map<string, AgentTask>()

  get all(): AgentTask[] {
    return [...this.tasks.values()]
  }

  get(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId)
  }

  /** 이미 있으면 갱신한다 — 같은 taskId 로 다시 오는 경우가 있다 */
  start(input: AgentTaskStartInput): boolean {
    if (!input.taskId) return false

    const existing = this.tasks.get(input.taskId)
    if (existing) {
      if (input.agentName) existing.agentName = input.agentName
      if (input.description) existing.description = input.description
      return true
    }

    this.tasks.set(input.taskId, {
      taskId: input.taskId,
      ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
      agentName: input.agentName ?? '서브에이전트',
      description: input.description ?? '',
      status: 'running',
      text: '',
      steps: [],
    })
    return true
  }

  end(input: AgentTaskEndInput): boolean {
    const task = this.tasks.get(input.taskId)
    // 짝 없는 종료는 버린다 (vscode 와 동일)
    if (!task) return false

    task.status = input.success === false ? 'failed' : 'success'
    if (input.error !== undefined) task.error = input.error
    if (input.durationSec !== undefined) task.durationSec = input.durationSec

    // 끝났는데 남아 있는 진행 중 단계는 닫아준다 — 영원히 도는 것처럼 보이지 않게
    for (const step of task.steps) {
      if (!step.done) step.done = true
    }
    return true
  }

  appendText(taskId: string, text: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || !text) return false
    task.text += text
    return true
  }

  addStep(taskId: string, step: Omit<AgentTaskStep, 'done'>): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false
    task.steps.push({ ...step, done: false })
    return true
  }

  /** 도구 결과를 해당 단계에 접는다. toolCallId 로 짝을 찾고, 없으면 마지막 미완료 단계에 붙인다. */
  completeStep(taskId: string, toolCallId: string | undefined, failed: boolean): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false

    const target = toolCallId
      ? task.steps.find((step) => step.toolCallId === toolCallId)
      : [...task.steps].reverse().find((step) => !step.done)
    if (!target) return false

    target.done = true
    if (failed) target.failed = true
    return true
  }

  reset(): void {
    this.tasks.clear()
  }
}
