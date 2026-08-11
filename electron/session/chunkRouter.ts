import { ChunkRoute, routeOf } from './chunkRoutes'
import {
  asBoolean,
  asNumber,
  asSemanticType,
  asString,
  optional,
  parseTimestamp,
} from './chunkFields'
import { parseInterrupt, type ApprovalRequest, type QuestionRequest, type PlanRequest } from './interrupts'
import { routeSubLane } from './subLane'
import type { MessageStore } from './messageStore'
import type { TurnMetaStore } from './turnMeta'
import type { AgentTaskStore } from './agentTaskStore'

// 설계 §5 매핑표를 집행한다. 표에 없는 결정은 여기서 내리지 않는다.
//
// 라우터는 "어디로 보낼지"만 정하고, 실제 변형은 MessageStore / TurnMetaStore 가 한다 (SRP).

export type { ApprovalRequest, QuestionRequest, PlanRequest } from './interrupts'

/**
 * 라우터가 해석한 결과. 호출자는 이것만 보고 이벤트를 만든다.
 * **파싱은 라우터 한 곳에서만 한다** — 호출자가 청크를 다시 해석하면
 * 해석기가 둘이 되어 서로 어긋난다.
 */
export type RouteEffect =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolName: string; toolCallId?: string }
  | { type: 'error'; message: string; code?: string }
  | { type: 'turn_started'; turnId: string }

export interface RouteResult {
  route: ChunkRoute | 'unknown'
  /** 화면에 변화가 생겼는가 — renderer 에 스냅샷을 밀지 판단하는 데 쓴다 */
  changed: boolean
  /** 무슨 일이 일어났는지. 호출자가 이벤트로 옮긴다. */
  effect?: RouteEffect
  /** 승인 요청이면 여기에 담긴다 */
  approval?: ApprovalRequest
  /** ask_user 질문이면 여기에 담긴다 */
  question?: QuestionRequest
  /** 계획 승인 요청이면 여기에 담긴다 */
  plan?: PlanRequest
}

export interface ChunkRouterDeps {
  messages: MessageStore
  turns: TurnMetaStore
  /** 서브에이전트 작업. 없으면 해당 청크를 무시한다. */
  tasks?: AgentTaskStore
  /** 표에 없는 타입을 만났을 때. 기본은 console.error (설계 §5.3) */
  onUnknownType?: (messageType: string, chunk: unknown) => void
}

export class ChunkRouter {
  constructor(private readonly deps: ChunkRouterDeps) {}

  route(chunk: Record<string, unknown>, streamId?: string): RouteResult {
    const messageType = chunk['messageType']
    if (typeof messageType !== 'string') return { route: 'unknown', changed: false }

    // 서브 레인 청크는 taskId/streamRole 로 구분해 작업에 접는다.
    // agent_task_start/end 자체는 taskId 가 있어도 레인 청크가 아니므로 제외한다.
    const taskId = asString(chunk['taskId'])
    const isSubLane =
      taskId !== undefined &&
      messageType !== 'agent_task_start' &&
      messageType !== 'agent_task_end' &&
      (chunk['streamRole'] === 'sub' || taskId.length > 0)
    if (isSubLane) return routeSubLane(this.deps.tasks, chunk, taskId)

    const route = routeOf(messageType)
    if (!route) {
      this.reportUnknown(messageType, chunk)
      return { route: 'unknown', changed: false }
    }

    switch (route) {
      case ChunkRoute.RENDERS: {
        const { changed, effect } = this.applyRenders(messageType, chunk, streamId)
        return { route, changed, ...(effect ? { effect } : {}) }
      }
      case ChunkRoute.FOLDS:
        return { route, changed: this.applyFolds(messageType, chunk, streamId) }
      case ChunkRoute.META_ONLY: {
        const effect = this.applyMeta(messageType, chunk)
        return effect ? { route, changed: false, effect } : { route, changed: false }
      }
      case ChunkRoute.INTERRUPT:
        return this.applyInterrupt(route, chunk)
      case ChunkRoute.SUB_AGENT:
        return { route, changed: this.applySubAgent(messageType, chunk) }
      case ChunkRoute.DEFERRED:
      case ChunkRoute.DROPPED:
        // 의도적으로 아무것도 하지 않는다. 표에 근거가 있는 드롭이다.
        return { route, changed: false }
    }
  }

  /**
   * 화면에 새 요소를 만드는 청크.
   *
   * `changed` 와 `effect` 를 따로 돌려준다 — 추론(thinking)처럼 **화면은 바뀌지만
   * 이벤트로 올릴 것은 없는** 종류가 있기 때문이다. 둘을 묶으면 그런 청크가
   * 스냅샷 푸시를 못 받아 조용히 사라진다.
   */
  private applyRenders(
    messageType: string,
    chunk: Record<string, unknown>,
    streamId?: string,
  ): { changed: boolean; effect?: RouteEffect } {
    const turnId = this.deps.turns.active ?? undefined

    if (messageType === 'text') {
      const text = asString(chunk['message'])
      if (!text) return { changed: false }
      this.deps.messages.appendText({
        text,
        ...(streamId !== undefined ? { streamId } : {}),
        ...optional('segmentId', asString(chunk['segmentId'])),
        ...optional('semanticType', asSemanticType(chunk['semanticType'])),
        ...optional('turnId', turnId),
      })
      return { changed: true, effect: { type: 'text', text } }
    }

    // 추론 토큰 (DC-1029/1030). 답변이 아니므로 text 이벤트를 내지 않는다 —
    // 내면 스피너·reply 추출이 이걸 답변으로 오인한다.
    if (messageType === 'thinking') {
      const text = asString(chunk['message'])
      if (!text) return { changed: false }
      this.deps.messages.appendThinking({
        text,
        ...(streamId !== undefined ? { streamId } : {}),
        ...optional('turnId', turnId),
      })
      return { changed: true }
    }

    if (messageType === 'tool_call') {
      const toolName = asString(chunk['toolName']) ?? '알 수 없는 도구'
      const toolCallId = asString(chunk['toolCallId'])
      this.deps.messages.addToolCall({
        toolName,
        ...optional('toolCallId', toolCallId),
        ...(chunk['toolArgs'] !== undefined ? { toolArgs: chunk['toolArgs'] } : {}),
        ...(streamId !== undefined ? { streamId } : {}),
        ...optional('turnId', turnId),
      })
      return {
        changed: true,
        effect: { type: 'tool_call', toolName, ...optional('toolCallId', toolCallId) },
      }
    }

    // error 와 agent_error 를 한 분기로 받는다 — 둘 다 실패를 화면에 남긴다.
    //
    // **agent_error 는 필드명이 다르다.** runtime agent/schemas.py:35 의 AgentErrorMessage 는
    // message/code 가 아니라 errorMessage/exceptionType 을 쓴다. error 분기를 필드명 그대로
    // 재사용하면 문구가 빈 채 "알 수 없는 오류" 만 뜬다.
    // (agent_error 가 왜 있는지는 chunkTypes.ts 의 AGENT_ERROR 주석 참조 — 구버전 이력 방어)
    if (messageType === 'error' || messageType === 'agent_error') {
      const message = asString(chunk['message']) ?? asString(chunk['errorMessage']) ?? '알 수 없는 오류'
      const code = asString(chunk['code']) ?? asString(chunk['exceptionType'])
      this.deps.messages.addError({
        message,
        ...optional('code', code),
        ...optional('turnId', turnId),
      })
      return { changed: true, effect: { type: 'error', message, ...optional('code', code) } }
    }

    return { changed: false }
  }

  private applyFolds(messageType: string, chunk: Record<string, unknown>, streamId?: string): boolean {
    if (messageType === 'tool_result') {
      return this.deps.messages.applyToolResult(
        {
          ...optional('toolCallId', asString(chunk['toolCallId'])),
          ...optional('toolName', asString(chunk['toolName'])),
          result: chunk['result'],
          ...optional('success', asBoolean(chunk['success'])),
          ...optional('error', asString(chunk['error'])),
        },
        streamId,
      )
    }

    if (messageType === 'type_revision') {
      const segmentId = asString(chunk['segmentId'])
      const semanticType = asSemanticType(chunk['semanticType'])
      if (!segmentId || !semanticType) return false
      return this.deps.messages.reviseSemanticType(segmentId, semanticType)
    }

    return false
  }

  private applyMeta(messageType: string, chunk: Record<string, unknown>): RouteEffect | undefined {
    const turnId = asString(chunk['turnId'])
    if (!turnId) return undefined

    if (messageType === 'turn_start') {
      // 같은 turnId 로 재개되는 경우는 새 턴이 아니다 (설계 §4.4)
      const isNewTurn = this.deps.turns.get(turnId) === undefined
      this.deps.turns.onTurnStart(turnId, parseTimestamp(chunk['startedAt']))
      return isNewTurn ? { type: 'turn_started', turnId } : undefined
    }

    if (messageType === 'turn_end') {
      this.deps.turns.onTurnEnd(turnId, {
        ...optional('durationMs', asNumber(chunk['durationMs'])),
        ...optional('stepCount', asNumber(chunk['stepCount'])),
        ...optional('terminal', asBoolean(chunk['terminal'])),
      })
      return undefined
    }

    return undefined
  }

  private applyInterrupt(route: ChunkRoute, chunk: Record<string, unknown>): RouteResult {
    // 종류별 해석은 interrupts.ts 가 한다 — 여기서 다시 읽으면 해석기가 둘이 된다
    return { route, changed: false, ...parseInterrupt(chunk) }
  }

  /**
   * 서브에이전트 작업 청크.
   * 최상위 메시지를 만들지 않고 작업에 접힌다 — 안 그러면 주 대화에 섞여 뒤죽박죽이 된다.
   */
  private applySubAgent(messageType: string, chunk: Record<string, unknown>): boolean {
    const tasks = this.deps.tasks
    if (!tasks) return false

    const taskId = asString(chunk['taskId'])
    if (!taskId) return false

    if (messageType === 'agent_task_start') {
      return tasks.start({
        taskId,
        ...optional('turnId', this.deps.turns.active ?? undefined),
        ...optional('agentName', asString(chunk['agentName'])),
        ...optional('description', asString(chunk['taskDescription'])),
      })
    }

    if (messageType === 'agent_task_end') {
      return tasks.end({
        taskId,
        ...optional('success', asBoolean(chunk['success'])),
        ...optional('error', asString(chunk['error'])),
        ...optional('durationSec', asNumber(chunk['duration'])),
      })
    }

    return false
  }

  private reportUnknown(messageType: string, chunk: unknown): void {
    if (this.deps.onUnknownType) return this.deps.onUnknownType(messageType, chunk)
    console.error(
      `[davis] 처리 규칙이 없는 messageType="${messageType}" — 설계 §5 매핑표를 갱신해야 합니다`,
      chunk,
    )
  }
}
