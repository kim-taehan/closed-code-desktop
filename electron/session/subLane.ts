import { ChunkRoute } from './chunkRoutes'
import { asString, optional } from './chunkFields'
import type { AgentTaskStore } from './agentTaskStore'
import type { RouteResult } from './chunkRouter'

// 서브 레인(taskId 보유) 청크를 해당 작업에 접는다.
// ChunkRouter 에서 응집 분리한 것으로 동작은 그대로다 — 라우터는 "어디로 보낼지"만 남긴다
// (interrupts.ts 가 인터럽트 해석을 가져간 것과 같은 형태).

/**
 * 서브 레인 청크를 작업에 접는다.
 * 라우팅 이전에 걸러야 한다 — 안 그러면 주 대화에 서브 텍스트가 섞인다.
 */
export function routeSubLane(
  tasks: AgentTaskStore | undefined,
  chunk: Record<string, unknown>,
  taskId: string,
): RouteResult {
  if (!tasks) return { route: ChunkRoute.SUB_AGENT, changed: false }

  const messageType = chunk['messageType']
  if (messageType === 'text') {
    const text = asString(chunk['message'])
    return { route: ChunkRoute.SUB_AGENT, changed: text ? tasks.appendText(taskId, text) : false }
  }
  if (messageType === 'tool_call') {
    const toolCallId = asString(chunk['toolCallId'])
    return {
      route: ChunkRoute.SUB_AGENT,
      changed: tasks.addStep(taskId, {
        toolName: asString(chunk['toolName']) ?? '알 수 없는 도구',
        ...optional('toolCallId', toolCallId),
      }),
    }
  }
  if (messageType === 'tool_result') {
    return {
      route: ChunkRoute.SUB_AGENT,
      changed: tasks.completeStep(taskId, asString(chunk['toolCallId']), Boolean(chunk['error'])),
    }
  }
  // 그 외 서브 레인 청크는 화면에 쓰지 않는다
  return { route: ChunkRoute.SUB_AGENT, changed: false }
}
