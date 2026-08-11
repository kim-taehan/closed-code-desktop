import type { TurnEvent } from '../../shared/ipc/turnEvent'

// 인터럽트(HIL) 청크 파싱. chunkRouter 가 300줄을 넘어 갈라냈다.
//
// 세 가지 인터럽트 모두 "답하지 않으면 턴이 그 자리에서 멈춘다"는 계약을 공유한다:
//   tool_approval_request → tool_approval_response   (ToolPermissionMiddleware)
//   user_question         → user_answer              (ask_user, DC-644)
//   plan_approval         → plan_approval_response   (propose_plan, DC-776)

export interface ApprovalRequest {
  requestId: string
  toolName: string
  args?: unknown
  /** 승인 사유·표시 이름. 런타임이 실어 보낸다 (tool_permission.py) */
  reason?: string
  displayName?: string
}

/** ask_user 질문 (DC-644). 답(user_answer)을 보내야 턴이 이어진다 */
export interface QuestionRequest {
  questionId: string
  question: string
  /** 제시된 선택지. 없으면 자유 입력이다 */
  options?: string[]
}

/** propose_plan 계획 승인 (DC-776). plan_approval_response 를 보내야 턴이 이어진다 */
export interface PlanRequest {
  planId: string
  summary: string
  filesToChange?: string[]
  estimatedSteps?: number
}

export interface ParsedInterrupt {
  approval?: ApprovalRequest
  question?: QuestionRequest
  plan?: PlanRequest
}

/**
 * 해석된 인터럽트 → renderer 로 보낼 턴 이벤트.
 * skipApproval 은 autoApprove 세션용 — 승인은 이미 자동 응답했으므로 이벤트를 내지 않는다.
 */
export function interruptTurnEvents(
  parsed: ParsedInterrupt,
  turnId: string,
  skipApproval: boolean,
): TurnEvent[] {
  const events: TurnEvent[] = []
  if (parsed.approval && !skipApproval) {
    const { requestId, toolName, args, reason, displayName } = parsed.approval
    events.push({
      type: 'approval_requested',
      turnId,
      requestId,
      toolName,
      args,
      ...(reason ? { reason } : {}),
      ...(displayName ? { displayName } : {}),
    })
  }
  if (parsed.question) events.push({ type: 'question_requested', turnId, ...parsed.question })
  if (parsed.plan) events.push({ type: 'plan_requested', turnId, ...parsed.plan })
  return events
}

/** INTERRUPT 경로 청크를 종류별로 해석한다. 필수 필드가 없으면 빈 결과다. */
export function parseInterrupt(chunk: Record<string, unknown>): ParsedInterrupt {
  const messageType = chunk['messageType']

  if (messageType === 'user_question') {
    const questionId = asString(chunk['questionId'])
    const question = asString(chunk['question']) ?? asString(chunk['message'])
    if (!questionId || !question) return {}
    const options = asStringArray(chunk['options'])
    return { question: { questionId, question, ...(options ? { options } : {}) } }
  }

  if (messageType === 'plan_approval') {
    const planId = asString(chunk['planId'])
    if (!planId) return {}
    const plan: PlanRequest = {
      planId,
      summary: asString(chunk['summary']) ?? asString(chunk['message']) ?? '',
    }
    const files = asStringArray(chunk['filesToChange'])
    if (files) plan.filesToChange = files
    const steps = asNumber(chunk['estimatedSteps'])
    if (steps !== undefined) plan.estimatedSteps = steps
    return { plan }
  }

  const requestId = asString(chunk['requestId'])
  if (!requestId) return {}
  const toolName = asString(chunk['toolName']) || '알 수 없는 도구'
  const approval: ApprovalRequest = { requestId, toolName, args: chunk['args'] }
  if (asString(chunk['reason'])) approval.reason = asString(chunk['reason'])
  if (asString(chunk['displayName'])) approval.displayName = asString(chunk['displayName'])
  return { approval }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items : undefined
}
