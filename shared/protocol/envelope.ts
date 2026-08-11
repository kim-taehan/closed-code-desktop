import { randomUUID } from 'node:crypto'
import type { Action, Kind } from './kinds'

// runtime 봉투. 출처: davis-code-runtime/src/app/websocket/protocol.py:151-170
//
// 설계 §4.1 함정: runtime 의 pydantic 모델은 populate_by_name 을 켜지 않아
// 별칭이 걸린 필드를 camelCase 로만 받는다. snake_case 로 보내면 필수 필드는
// ValidationError, 선택 필드는 "조용히 버려진다".
//
// 다만 별칭이 걸리지 않은 필드는 반대로 snake_case 가 정답이다.
// 아래 ALLOWED_SNAKE_CASE_KEYS 가 그 예외 목록이며, 이 목록에 없는 snake_case 키는
// 전송 직전에 실패시킨다 — 조용한 데이터 유실보다 시끄러운 실패가 낫다.

/**
 * 별칭이 없어 snake_case 로 보내야 하는 키. 근거를 함께 남긴다.
 *
 * runtime 은 도메인마다 규칙이 다르다 — chat 은 camelCase 별칭이 걸려 있고,
 * chat_history 는 별칭이 아예 없어 snake_case 가 정본이다.
 * "전부 camelCase" 로 뭉뚱그리면 조용히 무시되는 필드가 생긴다.
 */
const ALLOWED_SNAKE_CASE_KEYS = new Set([
  'ping_id', // pong fast-path. api/websocket.py:73-78
  'ide_type', // auth_request 선택 필드, 별칭 없음. domains/auth.py:8-29
  'plugin_version', // 같음
  'chat_id', // chat_history 요청. domains/chat_history.py:7-9 (별칭 없음)
  'server_name', // mcp_config 요청. domains/mcp_config.py:24-35 (이 도메인은 별칭이 없다)
  'provider_type', // llm_config 요청. domains/llm_config.py:12-26 (이 도메인도 별칭이 없다)
  'base_url', // 같음
  'api_key', // 같음
  // chat_request 의 activeEditor.selection. **camelCase 도메인 안의 snake_case 섬**이다 —
  // Selection 의 alias 가 필드명과 같아(`alias="start_offset"`) 이 두 키만 snake 가 정본이다.
  // domains/chat.py:7-9. 값은 문자 오프셋이 아니라 1-based 라인 번호다 (chatFrames.ts 주석 참조).
  'start_offset',
  'end_offset',
])

export interface OutboundEnvelope<TData = unknown> {
  kind: Kind
  action: Action
  reqId: string
  data: TData
  streamId?: string
  chatId?: string
}

export interface InboundEnvelope<TData = unknown> {
  kind: string
  action: string
  data?: TData
  replyTo?: string | null
  streamId?: string | null
  chatId?: string | null
  timestamp?: string | null
}

export interface EnvelopeOptions {
  streamId?: string
  chatId?: string
  /** 테스트에서 reqId 를 고정하기 위한 주입점. 평소에는 쓰지 않는다. */
  reqId?: string
}

/**
 * 봉투를 만든다. reqId 는 항상 채워진다 — runtime 은 기본값 없이 필수로 받으며,
 * 누락 시 ValidationError 로 error 프레임이 돌아온다 (protocol.py:151-159).
 */
export function createEnvelope<TData>(
  kind: Kind,
  action: Action,
  data: TData,
  options: EnvelopeOptions = {},
): OutboundEnvelope<TData> {
  const envelope: OutboundEnvelope<TData> = {
    kind,
    action,
    reqId: options.reqId ?? randomUUID(),
    data,
  }
  if (options.streamId !== undefined) envelope.streamId = options.streamId
  if (options.chatId !== undefined) envelope.chatId = options.chatId
  return envelope
}

/** 허용 목록에 없는 snake_case 키를 찾는다. 경로를 함께 돌려준다. */
export function findDisallowedSnakeCaseKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findDisallowedSnakeCaseKeys(item, `${path}[${index}]`))
  }
  if (value === null || typeof value !== 'object') return []

  const found: string[] = []
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (key.includes('_') && !ALLOWED_SNAKE_CASE_KEYS.has(key)) found.push(childPath)
    found.push(...findDisallowedSnakeCaseKeys(child, childPath))
  }
  return found
}

/**
 * 전송용 문자열로 직렬화한다. snake_case 위반이 있으면 던진다.
 *
 * 조용히 버려지는 필드는 추적이 거의 불가능한 버그가 되므로, 보내기 전에 막는다.
 */
export function serializeEnvelope(envelope: OutboundEnvelope): string {
  const violations = findDisallowedSnakeCaseKeys(envelope)
  if (violations.length > 0) {
    throw new Error(
      `봉투에 허용되지 않은 snake_case 키가 있습니다: ${violations.join(', ')}. ` +
        'runtime 은 별칭 필드를 camelCase 로만 받습니다 (설계 §4.1).',
    )
  }
  return JSON.stringify(envelope)
}

/** 수신 프레임 파싱. 형태가 아니면 null 을 돌려주고 던지지 않는다. */
export function parseInbound(raw: string): InboundEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null

  const candidate = parsed as Record<string, unknown>
  if (typeof candidate['kind'] !== 'string' || typeof candidate['action'] !== 'string') return null

  return parsed as InboundEnvelope
}
