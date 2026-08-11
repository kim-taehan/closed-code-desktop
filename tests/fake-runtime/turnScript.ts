// 턴 하나를 구성하는 서버→클라이언트 프레임 배열을 만드는 순수 함수들.
// 서버 소켓 수명과 분리해 두어 프레임 시퀀스만 따로 단위 테스트할 수 있다.

import { Action, Kind } from '../../shared/protocol/kinds'
import type { SemanticType, StreamEndData } from '../../shared/protocol/chunkTypes'

export interface ServerFrame {
  kind: string
  action: string
  replyTo?: string | null
  streamId?: string
  chatId?: string
  data?: unknown
}

export interface TurnScriptOptions {
  reqId: string
  streamId: string
  chatId: string
  turnId: string
}

function chunk(options: TurnScriptOptions, data: unknown): ServerFrame {
  return {
    kind: Kind.CHAT,
    action: Action.STREAM_CHUNK,
    replyTo: options.reqId,
    streamId: options.streamId,
    chatId: options.chatId,
    data,
  }
}

export function streamStart(options: TurnScriptOptions): ServerFrame {
  return {
    kind: Kind.CHAT,
    action: Action.STREAM_START,
    replyTo: options.reqId,
    streamId: options.streamId,
    chatId: options.chatId,
    data: { message: 'stream started' },
  }
}

export function turnStart(options: TurnScriptOptions): ServerFrame {
  return chunk(options, {
    messageType: 'turn_start',
    turnId: options.turnId,
    startedAt: new Date(0).toISOString(),
  })
}

export function textChunk(
  options: TurnScriptOptions,
  message: string,
  extra: { semanticType?: SemanticType; segmentId?: string } = {},
): ServerFrame {
  return chunk(options, { messageType: 'text', message, ...extra })
}

/** 추론 토큰 (DC-1029/1030). segmentId 가 없는 것이 계약이다 (domains/chat.py:144). */
export function thinkingChunk(options: TurnScriptOptions, message: string): ServerFrame {
  return chunk(options, { messageType: 'thinking', message })
}

export function toolCallChunk(
  options: TurnScriptOptions,
  toolName: string,
  toolCallId: string,
  toolArgs: unknown = {},
): ServerFrame {
  return chunk(options, { messageType: 'tool_call', toolName, toolCallId, toolArgs })
}

export function toolResultChunk(
  options: TurnScriptOptions,
  toolCallId: string,
  result: unknown,
  error?: string,
): ServerFrame {
  return chunk(options, {
    messageType: 'tool_result',
    toolCallId,
    result,
    success: error === undefined,
    ...(error === undefined ? {} : { error }),
  })
}

export function toolApprovalRequestChunk(
  options: TurnScriptOptions,
  requestId: string,
  toolName: string,
  args: unknown = {},
): ServerFrame {
  return chunk(options, { messageType: 'tool_approval_request', requestId, toolName, args })
}

/** ask_user 질문 청크 단독. 재생 억제 테스트처럼 턴 조립을 직접 할 때 쓴다 */
export function userQuestionChunk(
  options: TurnScriptOptions,
  questionId: string,
  question: string,
  choices?: string[],
): ServerFrame {
  return chunk(options, {
    messageType: 'user_question',
    questionId,
    question,
    ...(choices ? { options: choices } : {}),
  })
}

/** propose_plan 계획 승인 청크 단독 */
export function planApprovalChunk(
  options: TurnScriptOptions,
  planId: string,
  summary: string,
  extra: { filesToChange?: string[]; estimatedSteps?: number } = {},
): ServerFrame {
  return chunk(options, { messageType: 'plan_approval', planId, summary, ...extra })
}

/** ask_user 질문에서 멈추는 턴의 앞부분 (DC-644). 승인과 같은 인터럽트 계약이다. */
export function turnPausedForQuestion(
  options: TurnScriptOptions,
  questionId: string,
  question: string,
  options2?: string[],
): ServerFrame[] {
  return [
    streamStart(options),
    turnStart(options),
    userQuestionChunk(options, questionId, question, options2),
    streamEnd(options, { terminal: false, failed: false }),
  ]
}

/** propose_plan 계획 승인에서 멈추는 턴의 앞부분 (DC-776) */
export function turnPausedForPlan(
  options: TurnScriptOptions,
  planId: string,
  summary: string,
  extra: { filesToChange?: string[]; estimatedSteps?: number } = {},
): ServerFrame[] {
  return [
    streamStart(options),
    turnStart(options),
    planApprovalChunk(options, planId, summary, extra),
    streamEnd(options, { terminal: false, failed: false }),
  ]
}

/**
 * 실측: 실제 runtime 의 turn_end 는 terminal 을 함께 보낸다.
 * 이걸 빠뜨리면 하네스가 실제와 어긋나 "활성 턴이 언제 풀리는가"를 검증하지 못한다.
 */
export function turnEnd(
  options: TurnScriptOptions,
  durationMs = 1200,
  stepCount = 1,
  terminal = true,
): ServerFrame {
  return chunk(options, {
    messageType: 'turn_end',
    turnId: options.turnId,
    durationMs,
    stepCount,
    terminal,
  })
}

export function streamEnd(options: TurnScriptOptions, data: StreamEndData): ServerFrame {
  return {
    kind: Kind.CHAT,
    action: Action.STREAM_END,
    replyTo: options.reqId,
    streamId: options.streamId,
    chatId: options.chatId,
    data,
  }
}

/** 텍스트만 있는 가장 단순한 턴. A7 스모크와 동형이다. */
export function textOnlyTurn(options: TurnScriptOptions, message: string): ServerFrame[] {
  return [
    streamStart(options),
    turnStart(options),
    textChunk(options, message, { semanticType: 'reply' }),
    turnEnd(options),
    streamEnd(options, { terminal: true, failed: false }),
  ]
}

/**
 * 승인 요청에서 멈추는 턴의 앞부분.
 * terminal:false 로 끝나므로 클라이언트는 턴을 닫지 않아야 한다 (설계 §4.4).
 */
export function turnPausedForApproval(
  options: TurnScriptOptions,
  requestId: string,
  toolName = 'edit_file',
): ServerFrame[] {
  return [
    streamStart(options),
    turnStart(options),
    toolApprovalRequestChunk(options, requestId, toolName),
    streamEnd(options, { terminal: false, failed: false }),
  ]
}

/** 승인 이후 재개되는 뒷부분. 같은 turnId 로 이어진다. */
export function turnResumedAfterApproval(
  options: TurnScriptOptions,
  message: string,
): ServerFrame[] {
  return [
    streamStart(options),
    textChunk(options, message, { semanticType: 'reply' }),
    turnEnd(options),
    streamEnd(options, { terminal: true, failed: false }),
  ]
}

/** 실패로 끝나는 턴. error 프레임이 먼저 오고 stream_end 가 failed 로 닫는다. */
export function failedTurn(options: TurnScriptOptions, code: string, message: string): ServerFrame[] {
  return [
    streamStart(options),
    turnStart(options),
    { kind: Kind.CHAT, action: Action.ERROR, replyTo: options.reqId, streamId: options.streamId, data: { code, message } },
    streamEnd(options, { terminal: true, failed: true, errorCode: code }),
  ]
}
