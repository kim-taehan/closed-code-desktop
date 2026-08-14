import type { Transport } from '../ws/transport'
import {
  approvalFrame,
  planResponseFrame,
  userAnswerFrame,
  type ApprovalFollowUp,
} from './chatFrames'

// **사용자가 카드에 답하는 세 자리.** 승인·질문·계획.
//
// `chatSession.ts` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았다. 셋을 함께 둔 이유:
// 전부 **턴을 이어 가게 하는 답신**이고, 보내지 않으면 턴이 그 자리에서 멈춘다.
// 세션 상태를 안 건드리고 프레임 하나를 내보내기만 한다.

export interface ChatResponder {
  /** 승인 응답. 보내지 않으면 턴이 그 자리에서 멈춘다 */
  approval(requestId: string, approved: boolean, followUp?: ApprovalFollowUp): boolean
  /** ask_user 답. null 은 취소 — 어느 쪽이든 보내야 턴이 이어진다 */
  question(questionId: string, answer: string | null): boolean
  /** 계획 승인/거부 응답 */
  plan(planId: string, approved: boolean, comment?: string): boolean
}

/** `chatId` 는 **부를 때마다 읽는다** — 세션이 도중에 발급받아 심는다 (`setChatId`). */
export function createResponder(transport: Transport, chatId: () => string | null): ChatResponder {
  return {
    approval: (requestId, approved, followUp) =>
      transport.send(approvalFrame(requestId, approved, { chatId: chatId() }, followUp)),
    question: (questionId, answer) =>
      transport.send(userAnswerFrame(questionId, answer, { chatId: chatId() })),
    plan: (planId, approved, comment) =>
      transport.send(planResponseFrame(planId, approved, comment, { chatId: chatId() })),
  }
}
