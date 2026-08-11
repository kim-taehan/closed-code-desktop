import type {
  ChatSnapshotPayload,
  HistoryStatePayload,
  ReviewStatePayload,
  SessionStatePayload,
  TurnEvent,
  WorkingDirPayload,
} from '../../shared/ipc/channels'
import type { ApprovalRequest } from '../components/ApprovalModal'
import { PermissionMode } from '../../shared/protocol/kinds'
import type { SpinnerMode } from '../lib/davis-progress'

// 프로젝트 하나의 화면 상태.
//
// 프로젝트마다 세션이 따로 도므로 이 덩어리도 프로젝트마다 하나씩 있다.
// 탭을 옮겨도 상대 프로젝트의 대화가 그대로 남아 있어야 하기 때문에
// 활성 프로젝트만 들고 있을 수 없다.

export interface SessionSlice {
  session: SessionStatePayload | null
  /** runtime 수명/설치 상태. 설치 진행률·미설치 안내를 화면이 쓴다. */
  snapshot: ChatSnapshotPayload
  history: HistoryStatePayload
  reviews: ReviewStatePayload
  permissionMode: PermissionMode
  /**
   * 현재 세션 작업 경로 (ADR-036). runtime 이 push 한 값만 담는다 —
   * override 가 없으면 active:false 라 화면에 아무것도 그리지 않는다.
   */
  workingDir: WorkingDirPayload
  /**
   * 대기 중인 도구 승인들. 한 턴에서 승인 요청이 여러 개 동시에 올 수 있어 **큐**로 든다 —
   * 하나만 들면 나중 것이 앞 것을 덮어써 답하지 못한 승인 때문에 턴이 영영 멈춘다.
   * 화면은 맨 앞(approvals[0]) 하나만 모달로 보이고, 답하면 다음이 나온다.
   */
  approvals: ApprovalRequest[]
  /**
   * ask_user 질문들. runtime 은 병렬 task 로 인터럽트를 동시 여러 개 보낼 수 있어
   * (chat_service.py `_pending_interrupts` FIFO) 승인과 같은 **큐**로 든다 —
   * 단일 슬롯이면 둘째 질문이 첫째를 덮어써 첫째 미응답으로 턴이 영영 멈춘다.
   */
  questions: QuestionRequest[]
  /** propose_plan 계획 승인 요청들. 질문과 같은 이유로 큐다. */
  plans: PlanRequest[]
  isStreaming: boolean
  mode: SpinnerMode
  /** 진행 표시를 다시 튀게 하는 값. 내용이 아니라 변화 자체가 신호다. */
  activityKey: number
}

/** ask_user 질문 (DC-644) */
export interface QuestionRequest {
  questionId: string
  question: string
  options?: string[]
}

/** propose_plan 계획 승인 요청 (DC-776) */
export interface PlanRequest {
  planId: string
  summary: string
  filesToChange?: string[]
  estimatedSteps?: number
}

export const EMPTY_SLICE: SessionSlice = {
  session: null,
  snapshot: { messages: [], turnMetas: [], agentTasks: [] },
  history: { entries: [], loading: false, loadingChatId: null, current: null },
  reviews: { reviews: [] },
  permissionMode: PermissionMode.DEFAULT,
  workingDir: { active: false },
  approvals: [],
  questions: [],
  plans: [],
  isStreaming: false,
  mode: 'idle',
  activityKey: 0,
}

/**
 * 턴 이벤트를 상태에 반영한다 (설계 §6.8 진행 표시 전이).
 *
 * 비활성 프로젝트의 이벤트도 그대로 들어온다 — 그래야 탭을 다시 열었을 때
 * 그동안 오간 내용이 남아 있고, 탭 배지도 갱신할 수 있다.
 */
export function applyTurnEvent(slice: SessionSlice, event: TurnEvent): SessionSlice {
  switch (event.type) {
    case 'turn_started':
      return { ...slice, isStreaming: true, mode: 'requesting' }
    case 'text':
      return { ...slice, mode: 'responding', activityKey: slice.activityKey + 1 }
    case 'tool_call':
      return { ...slice, mode: 'tool-use', activityKey: slice.activityKey + 1 }
    case 'turn_ended':
      return { ...slice, isStreaming: false, mode: 'idle', approvals: [], questions: [], plans: [] }
    case 'question_requested': {
      // 같은 질문이 재전송되면 무시한다. 여러 질문은 큐에 쌓아 하나씩 답한다 (승인과 같은 계약).
      if (slice.questions.some((request) => request.questionId === event.questionId)) return slice
      const request: QuestionRequest = {
        questionId: event.questionId,
        question: event.question,
        ...(event.options ? { options: event.options } : {}),
      }
      return { ...slice, questions: [...slice.questions, request] }
    }
    case 'plan_requested': {
      if (slice.plans.some((request) => request.planId === event.planId)) return slice
      const request: PlanRequest = {
        planId: event.planId,
        summary: event.summary,
        ...(event.filesToChange ? { filesToChange: event.filesToChange } : {}),
        ...(event.estimatedSteps !== undefined ? { estimatedSteps: event.estimatedSteps } : {}),
      }
      return { ...slice, plans: [...slice.plans, request] }
    }
    case 'approval_requested': {
      // 같은 요청이 재전송되면 무시한다. 여러 승인은 큐에 쌓아 하나씩 답한다.
      if (slice.approvals.some((request) => request.requestId === event.requestId)) return slice
      const request: ApprovalRequest = {
        requestId: event.requestId,
        toolName: event.toolName,
        args: event.args,
        ...(event.reason ? { reason: event.reason } : {}),
        ...(event.displayName ? { displayName: event.displayName } : {}),
      }
      return { ...slice, approvals: [...slice.approvals, request] }
    }
    default:
      return slice
  }
}

/** 이 프로젝트가 지금 무언가 하고 있는가 — 탭 배지의 근거 */
export function isBusy(slice: SessionSlice | undefined): boolean {
  if (slice === undefined) return false
  return slice.isStreaming || slice.approvals.length > 0 || slice.questions.length > 0 || slice.plans.length > 0
}
