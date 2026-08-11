import type { ErrorSeverity } from '../protocol/errorMessages'
import type { SemanticType } from '../protocol/chunkTypes'

// 채팅 메시지 모델. main 이 조립하고 renderer 가 렌더하므로 양쪽이 같은 타입을 본다.
// 설계 §6 의 렌더 규칙이 이 모델 위에서 정의된다.

export const MessageKind = {
  TEXT: 'text',
  /** DC-1029/1030 추론 토큰. 답변과 별개 버블이며 기본 접힘이다. */
  THINKING: 'thinking',
  TOOL_CALL: 'tool_call',
  ERROR: 'error',
  AGENT_TASK_START: 'agent_task_start',
  CODE_DIFF: 'code_diff',
  SYSTEM: 'system',
} as const

export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind]

export interface ToolResult {
  /** 화면용 문자열. 객체 결과는 여기서 이미 문자열화돼 있다. */
  message?: string
  /**
   * 원본 결과. stdout/stderr 를 OUT/ERR 행으로 나누려면 원본이 필요하다 (설계 §6.6).
   * 문자열로 뭉개면 그 규칙을 지킬 수 없다.
   */
  raw?: unknown
  success?: boolean
  error?: string
}

/**
 * 사용자가 붙인 것의 **요약**. 내용(base64)은 담지 않는다 —
 * 스냅샷은 청크마다 IPC 로 나가므로 이미지를 실으면 수 MB 가 반복 전송된다.
 */
export interface AttachmentSummary {
  name: string
  kind: 'image' | 'file'
  /** 바이트. 파일은 경로만 보내므로 없을 수 있다. */
  bytes?: number
}

export interface ChatMessage {
  id: string
  /**
   * 로컬 셸 실행 결과. **runtime 은 이 내용을 모른다** —
   * 화면에만 남으므로 이어서 물으려면 따로 넘겨야 한다.
   */
  shell?: { command: string; output: string }
  /** 이 메시지와 함께 보낸 첨부 (user 메시지만) */
  attachments?: AttachmentSummary[]
  /** user 메시지는 턴 밖에서 따로 렌더된다 (설계 §6.8) */
  author: 'user' | 'assistant'
  kind: MessageKind
  content: string
  /** turn_start 가 연 턴. 새로 삽입되는 assistant 메시지에만 찍힌다 (설계 §6.3) */
  turnId?: string
  semanticType?: SemanticType
  /**
   * 에러 메시지의 심각도. 카탈로그(shared/protocol/errorMessages.ts)가 정한다.
   *
   * 전부 같은 빨강으로 그리면 "잠시 후 다시 시도" 같은 안내가 치명적 오류처럼 보인다 —
   * 카탈로그 24종 중 절반이 warning/info 다.
   */
  severity?: ErrorSeverity
  /** 텍스트 버블 경계는 (streamId, segmentId) 튜플이다 */
  segmentId?: string
  streamId?: string
  toolName?: string
  toolCallId?: string
  /** 도구 인자 원본. 칩 라벨과 IN 행을 만드는 데 쓴다 (설계 §6.6). */
  toolArgs?: unknown
  /** tool_result 는 자기 메시지를 만들지 않고 여기에 접힌다 (설계 §5.2) */
  toolResult?: ToolResult
  interrupted?: boolean
  timestamp?: string
}

/**
 * 턴의 토큰 사용량. **종단 stream_end 에서만** 온다 (설계 §6.1).
 * 비종단(승인 대기 등) 세그먼트는 세션 합계에만 더하고 턴 줄을 만들지 않는다.
 */
export interface TurnTokens {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  contextLength?: number
  contextUsageRatio?: number
  model?: string
  cost?: number
  durationSec?: number
  /** 직전 LLM 호출의 input 토큰 = 현재 컨텍스트 크기 */
  lastInputTokens?: number
  /** DC-1019: 카테고리별 토큰 분해 — 세션 컨텍스트 바의 상세 */
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

/** turn_start / turn_end 가 남기는 메타. DOM 은 만들지 않는다 (설계 §5.2) */
export interface TurnMeta {
  turnId: string
  startedAt?: number
  durationMs?: number
  stepCount?: number
  terminal?: boolean
  tokens?: TurnTokens
}

/**
 * 비활성 창 OS 알림 (renderer → main).
 * 프로젝트 이름은 main 이 붙인다 — renderer 는 무슨 일로 부르는지만 알린다.
 */
export interface TaskNoticePayload {
  /** 비우면 작업 완료 */
  kind?: 'toolRequest' | 'question' | 'plan'
  /** 어느 프로젝트의 턴인지. 이름은 main 이 붙인다 — 이게 없으면 활성 프로젝트로 오인한다. */
  projectId?: string
  /** 응답 대기일 때 무엇을 기다리는지 (툴 이름). 대화 내용은 싣지 않는다. */
  detail?: string
}

/** 로컬 안내 한 쌍. 이스터에그(개발자 모드 전환) 등 runtime 을 거치지 않는 응답에 쓴다. */
export interface LocalNoticePayload {
  userText: string
  noticeText: string
}
