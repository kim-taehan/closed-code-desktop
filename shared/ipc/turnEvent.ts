// 한 턴 동안 main → renderer 로 흐르는 이벤트. channels.ts 가 300줄을 넘어 갈라냈다.

export type TurnEvent =
  | { type: 'turn_started'; turnId: string }
  | { type: 'text'; turnId: string; text: string }
  | { type: 'tool_call'; turnId: string; toolName: string; toolCallId?: string }
  | {
      type: 'approval_requested'
      turnId: string
      requestId: string
      toolName: string
      args?: unknown
      reason?: string
      displayName?: string
    }
  | {
      /** ask_user 질문 (DC-644). 답하지 않으면 턴이 멈춘다 */
      type: 'question_requested'
      turnId: string
      questionId: string
      question: string
      options?: string[]
    }
  | {
      /** propose_plan 계획 승인 요청 (DC-776) */
      type: 'plan_requested'
      turnId: string
      planId: string
      summary: string
      filesToChange?: string[]
      estimatedSteps?: number
    }
  | { type: 'turn_ended'; turnId: string; failed: boolean; errorCode?: string }
  | { type: 'error'; message: string; code?: string }

/** ask_user 답 (renderer → main). answer=null 은 취소다 */
export interface QuestionRespondPayload {
  questionId: string
  answer: string | null
}

/** 계획 승인/거부 응답 (renderer → main) */
export interface PlanRespondPayload {
  planId: string
  approved: boolean
  comment?: string
}
