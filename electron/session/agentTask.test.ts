import { describe, expect, it } from 'vitest'
import { AgentTaskStore } from './agentTaskStore'
import { ChunkRouter } from './chunkRouter'
import { MessageStore } from './messageStore'
import { TurnMetaStore } from './turnMeta'
import { ChunkRoute } from './chunkRoutes'

// 서브에이전트 작업.
// 서브 레인 청크는 최상위 메시지가 되지 않고 작업에 접혀야 한다 —
// 섞이면 주 대화에 서브 텍스트가 끼어들어 누가 무슨 말을 했는지 알 수 없다.

function setup() {
  const messages = new MessageStore()
  const turns = new TurnMetaStore()
  const tasks = new AgentTaskStore()
  const router = new ChunkRouter({ messages, turns, tasks })
  turns.onTurnStart('turn-1')
  return { messages, turns, tasks, router }
}

describe('작업 수명', () => {
  it('시작하면 진행 중으로 잡히고 활성 턴이 기록된다', () => {
    const ctx = setup()
    ctx.router.route({
      messageType: 'agent_task_start',
      taskId: 'task-1',
      agentName: 'general_purpose',
      taskDescription: '파일 수정',
    })

    const task = ctx.tasks.get('task-1')!
    expect(task.status).toBe('running')
    expect(task.agentName).toBe('general_purpose')
    expect(task.description).toBe('파일 수정')
    expect(task.turnId).toBe('turn-1')
  })

  it('작업은 최상위 메시지를 만들지 않는다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_start', taskId: 'task-1' })
    expect(ctx.messages.messages).toHaveLength(0)
  })

  it('종료하면 성공/실패가 기록된다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_start', taskId: 'task-1' })
    ctx.router.route({ messageType: 'agent_task_end', taskId: 'task-1', success: true, duration: 3.5 })

    const task = ctx.tasks.get('task-1')!
    expect(task.status).toBe('success')
    expect(task.durationSec).toBe(3.5)
  })

  it('실패하면 사유를 담는다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_start', taskId: 'task-1' })
    ctx.router.route({ messageType: 'agent_task_end', taskId: 'task-1', success: false, error: '권한 없음' })

    expect(ctx.tasks.get('task-1')).toMatchObject({ status: 'failed', error: '권한 없음' })
  })

  it('짝 없는 종료는 버린다 — 유령 작업을 만들지 않는다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_end', taskId: '없는작업', success: true })
    expect(ctx.tasks.all).toHaveLength(0)
  })

  it('taskId 가 없으면 무시한다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_start', agentName: 'x' })
    expect(ctx.tasks.all).toHaveLength(0)
  })

  it('같은 taskId 로 다시 오면 갱신한다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_start', taskId: 'task-1', agentName: '처음' })
    ctx.router.route({ messageType: 'agent_task_start', taskId: 'task-1', agentName: '나중' })

    expect(ctx.tasks.all).toHaveLength(1)
    expect(ctx.tasks.get('task-1')!.agentName).toBe('나중')
  })
})

describe('서브 레인 청크', () => {
  it('서브 텍스트는 주 대화가 아니라 작업에 접힌다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_start', taskId: 'task-1' })
    ctx.router.route({ messageType: 'text', message: '서브 작업 중', taskId: 'task-1', streamRole: 'sub' })

    expect(ctx.messages.messages).toHaveLength(0)
    expect(ctx.tasks.get('task-1')!.text).toBe('서브 작업 중')
  })

  it('서브 텍스트는 이어붙는다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_start', taskId: 'task-1' })
    ctx.router.route({ messageType: 'text', message: '첫 ', taskId: 'task-1', streamRole: 'sub' })
    ctx.router.route({ messageType: 'text', message: '둘', taskId: 'task-1', streamRole: 'sub' })

    expect(ctx.tasks.get('task-1')!.text).toBe('첫 둘')
  })

  it('서브 도구 호출은 작업 단계가 된다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_start', taskId: 'task-1' })
    ctx.router.route({
      messageType: 'tool_call',
      toolName: 'edit_file',
      toolCallId: 'tc1',
      taskId: 'task-1',
      streamRole: 'sub',
    })

    expect(ctx.messages.messages).toHaveLength(0)
    expect(ctx.tasks.get('task-1')!.steps).toEqual([
      { toolName: 'edit_file', toolCallId: 'tc1', done: false },
    ])
  })

  it('서브 도구 결과는 그 단계를 닫는다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_start', taskId: 'task-1' })
    ctx.router.route({ messageType: 'tool_call', toolName: 'edit_file', toolCallId: 'tc1', taskId: 'task-1' })
    ctx.router.route({ messageType: 'tool_result', toolCallId: 'tc1', taskId: 'task-1', result: 'ok' })

    const step = ctx.tasks.get('task-1')!.steps[0]!
    expect(step.done).toBe(true)
    expect(step.failed).toBeUndefined()
  })

  it('실패한 도구 결과는 단계를 실패로 표시한다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_start', taskId: 'task-1' })
    ctx.router.route({ messageType: 'tool_call', toolName: 'edit_file', toolCallId: 'tc1', taskId: 'task-1' })
    ctx.router.route({ messageType: 'tool_result', toolCallId: 'tc1', taskId: 'task-1', error: '실패' })

    expect(ctx.tasks.get('task-1')!.steps[0]!.failed).toBe(true)
  })

  it('작업이 끝나면 남은 진행 중 단계를 닫는다 — 영원히 도는 것처럼 보이지 않게', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_start', taskId: 'task-1' })
    ctx.router.route({ messageType: 'tool_call', toolName: 'run_command', taskId: 'task-1' })
    ctx.router.route({ messageType: 'agent_task_end', taskId: 'task-1', success: true })

    expect(ctx.tasks.get('task-1')!.steps.every((step) => step.done)).toBe(true)
  })

  it('짝 없는 서브 청크는 버린다', () => {
    const ctx = setup()
    const result = ctx.router.route({ messageType: 'text', message: 'x', taskId: '없는작업', streamRole: 'sub' })

    expect(result.route).toBe(ChunkRoute.SUB_AGENT)
    expect(result.changed).toBe(false)
    expect(ctx.messages.messages).toHaveLength(0)
  })

  it('taskId 없는 텍스트는 평소대로 주 대화에 간다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'text', message: '주 대화' })

    expect(ctx.messages.messages).toHaveLength(1)
    expect(ctx.messages.messages[0]!.content).toBe('주 대화')
  })
})

describe('초기화', () => {
  it('새 대화를 시작하면 작업도 비운다', () => {
    const ctx = setup()
    ctx.router.route({ messageType: 'agent_task_start', taskId: 'task-1' })

    ctx.tasks.reset()
    expect(ctx.tasks.all).toEqual([])
  })
})
