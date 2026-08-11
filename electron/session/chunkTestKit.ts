import { ChunkType } from '../../shared/protocol/chunkTypes'
import { ChunkRouter } from './chunkRouter'
import { MessageStore } from './messageStore'
import { TurnMetaStore } from './turnMeta'

// 청크 라우터 테스트 공용 준비 코드.
// 대표 페이로드 표를 한곳에 두어, 전수 테스트와 동작 테스트가 같은 입력을 쓰게 한다.

export function setup(onUnknownType?: (type: string, chunk: unknown) => void) {
  const messages = new MessageStore()
  const turns = new TurnMetaStore()
  const router = new ChunkRouter({ messages, turns, ...(onUnknownType ? { onUnknownType } : {}) })
  return { messages, turns, router }
}

/**
 * 각 청크 타입의 대표 페이로드.
 * **모든 ChunkType 에 항목이 있어야 한다** — 없으면 전수 테스트가 그 타입을 건너뛴다.
 * Record 타입이라 타입을 빠뜨리면 컴파일이 실패한다.
 */
export const SAMPLE_CHUNKS: Record<ChunkType, Record<string, unknown>> = {
  [ChunkType.TEXT]: { messageType: 'text', message: '안녕하세요' },
  [ChunkType.THINKING]: { messageType: 'thinking', message: '먼저 파일을 확인하자' },
  [ChunkType.TOOL_CALL]: { messageType: 'tool_call', toolName: 'read_file', toolCallId: 'tc1' },
  [ChunkType.ERROR]: { messageType: 'error', message: '실패했습니다', code: 'SERVICE_ERROR' },
  [ChunkType.TOOL_RESULT]: { messageType: 'tool_result', toolCallId: 'tc1', result: '결과' },
  [ChunkType.TYPE_REVISION]: { messageType: 'type_revision', segmentId: 's1', semanticType: 'reply' },
  [ChunkType.TURN_START]: { messageType: 'turn_start', turnId: 't1' },
  [ChunkType.TURN_END]: { messageType: 'turn_end', turnId: 't1', durationMs: 1200 },
  [ChunkType.TOOL_APPROVAL_REQUEST]: {
    messageType: 'tool_approval_request',
    requestId: 'r1',
    toolName: 'edit_file',
  },
  [ChunkType.AGENT_TASK_START]: { messageType: 'agent_task_start', taskId: 'a1' },
  [ChunkType.AGENT_TASK_END]: { messageType: 'agent_task_end', taskId: 'a1' },
  [ChunkType.USER_QUESTION]: { messageType: 'user_question', questionId: 'q1', question: '어느 쪽?' },
  [ChunkType.PLAN_APPROVAL]: { messageType: 'plan_approval', planId: 'p1', summary: '계획' },
  [ChunkType.CODE_DIFF]: { messageType: 'code_diff', modifiedCode: 'x' },
  [ChunkType.SYSTEM]: { messageType: 'system', message: '시스템' },
  // 필드명이 error 청크와 다르다 — runtime agent/schemas.py:35 의 AgentErrorMessage 형태 그대로다
  [ChunkType.AGENT_ERROR]: {
    messageType: 'agent_error',
    exceptionType: 'ToolException',
    errorMessage: '에이전트 실행이 중단됐습니다',
  },
}
