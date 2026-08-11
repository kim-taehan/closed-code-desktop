// stream_chunk 의 data 는 messageType 으로 갈리는 유니온이다.
// 출처: davis-code-runtime/src/app/websocket/domains/chat.py:103-118, 333-348
//
// 설계 §5 매핑표의 타입 목록이 여기에 그대로 대응한다.
// 여기 없는 messageType 이 오면 "표의 누락"이며, 렌더 규칙을 지어내지 않는다 (설계 §5.3).

export const ChunkType = {
  TURN_START: 'turn_start',
  TEXT: 'text',
  THINKING: 'thinking',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  TURN_END: 'turn_end',
  TYPE_REVISION: 'type_revision',
  SYSTEM: 'system',
  ERROR: 'error',
  TOOL_APPROVAL_REQUEST: 'tool_approval_request',
  USER_QUESTION: 'user_question',
  PLAN_APPROVAL: 'plan_approval',
  AGENT_TASK_START: 'agent_task_start',
  AGENT_TASK_END: 'agent_task_end',
  CODE_DIFF: 'code_diff',
  /**
   * **현행 runtime 에는 송신처가 없다. 지우지 말 것 — 구버전 이력 방어다.**
   *
   * runtime `websocket/domains/chat.py:115` 에 enum 으로는 있으나, 그 값을 쓰는
   * `agent/schemas.py:35` 의 `AgentErrorMessage` 는 `BaseChatMessage` 를 상속하지 않고
   * 필드도 `exceptionType`/`errorMessage` 둘뿐이라 stream_chunk 로 내보내는 코드가 없다.
   * 실사용은 `runtime/conversation_manager.py:542` 하나 — **JSONL 이력을 훑어**
   * `data.messageType === 'agent_error'` 면 그 대화 status 를 error 로 매기는 판독 경로다.
   *
   * 그래서 이 등재는 "현행 유실 버그 수정"이 아니라 **구버전 runtime 이 남긴 이력을
   * 재생할 때 실패 턴이 조용히 사라지지 않게 하는 방어**다 (이력 재생도 같은 라우터를
   * 탄다 — chatSession.ts 의 replay 경로). "안 오는데 왜 있지"로 삭제하면
   * 옛 이력의 실패가 다시 침묵한다.
   *
   * ⚠️ 페이로드 필드명이 `error` 청크와 다르다 (`message`/`code` 가 아니라
   * `errorMessage`/`exceptionType`) — chunkRouter 의 error 분기 주석 참조.
   */
  AGENT_ERROR: 'agent_error',
} as const

export type ChunkType = (typeof ChunkType)[keyof typeof ChunkType]

/** 설계 §5 매핑표에 실려 있는 타입 전체. 전수 테스트(§9.1)가 이 목록을 순회한다. */
export const ALL_CHUNK_TYPES: readonly ChunkType[] = Object.values(ChunkType)

/** semanticType — vscode 의 cc-assistant-message--{value} 클래스에 대응 (설계 §6.7) */
export const SemanticType = {
  PLAN: 'plan',
  TOOL_SUMMARY: 'tool_summary',
  REFLECTION: 'reflection',
  ERROR: 'error',
  REPLY: 'reply',
} as const

export type SemanticType = (typeof SemanticType)[keyof typeof SemanticType]

export interface TurnStartChunk {
  messageType: typeof ChunkType.TURN_START
  turnId: string
  startedAt?: string
}

export interface TextChunk {
  messageType: typeof ChunkType.TEXT
  message: string
  semanticType?: SemanticType
  segmentId?: string
}

/**
 * 추론(reasoning) 토큰. 답변(TextChunk)과 분리해 온다 — domains/chat.py:141-147.
 *
 * **segmentId 가 없다** (의도적). 답변 텍스트 전용인 type_revision 네임스페이스와
 * 겹치지 않게 런타임이 뺀 것이라, 버블 묶기는 streamId 로만 한다.
 */
export interface ThinkingChunk {
  messageType: typeof ChunkType.THINKING
  message: string
}

export interface ToolCallChunk {
  messageType: typeof ChunkType.TOOL_CALL
  toolName: string
  toolCallId?: string
  toolArgs?: unknown
}

export interface ToolResultChunk {
  messageType: typeof ChunkType.TOOL_RESULT
  toolName?: string
  toolCallId?: string
  result?: unknown
  success?: boolean
  error?: string
}

export interface TurnEndChunk {
  messageType: typeof ChunkType.TURN_END
  turnId: string
  durationMs?: number
  stepCount?: number
  terminal?: boolean
}

export interface TypeRevisionChunk {
  messageType: typeof ChunkType.TYPE_REVISION
  segmentId: string
  semanticType: SemanticType
}

export interface ToolApprovalRequestChunk {
  messageType: typeof ChunkType.TOOL_APPROVAL_REQUEST
  requestId: string
  toolName: string
  args?: unknown
  reason?: string
  displayName?: string
  primaryText?: string
}

/** M1 이 구조를 해석하지 않는 타입. 드롭 여부는 설계 §5.2 표를 따른다. */
export interface OpaqueChunk {
  messageType: Exclude<
    ChunkType,
    | typeof ChunkType.TURN_START
    | typeof ChunkType.TEXT
    | typeof ChunkType.THINKING
    | typeof ChunkType.TOOL_CALL
    | typeof ChunkType.TOOL_RESULT
    | typeof ChunkType.TURN_END
    | typeof ChunkType.TYPE_REVISION
    | typeof ChunkType.TOOL_APPROVAL_REQUEST
  >
  [key: string]: unknown
}

export type StreamChunk =
  | TurnStartChunk
  | TextChunk
  | ThinkingChunk
  | ToolCallChunk
  | ToolResultChunk
  | TurnEndChunk
  | TypeRevisionChunk
  | ToolApprovalRequestChunk
  | OpaqueChunk

/** stream_end 의 data — domains/chat.py:306-329 */
export interface StreamEndData {
  terminal?: boolean
  failed?: boolean
  errorCode?: string
  tokenUsage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    contextLength?: number
    contextUsageRatio?: number
    model?: string
    /** 직전 LLM 호출의 input 토큰 = 현재 컨텍스트 크기 (domains/chat.py:284) */
    lastInputTokens?: number
    /** DC-1019: 카테고리별 토큰 분해. 세션 컨텍스트 바가 쓴다 */
    contextBreakdown?: {
      systemPrompt?: number
      agent?: number
      memory?: number
      skills?: number
      conversation?: number
      toolResults?: number
    }
    /** DC-1019: "normal" | "caution" | "danger" */
    usageWarningLevel?: string
    /** DC-1019: 모델의 유효 작업 윈도우(토큰) */
    effectiveWorkingWindow?: number
  }
}

export function isKnownChunkType(value: unknown): value is ChunkType {
  return typeof value === 'string' && (ALL_CHUNK_TYPES as readonly string[]).includes(value)
}
