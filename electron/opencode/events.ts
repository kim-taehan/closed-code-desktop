// opencode 서버가 SSE(`GET /event`)로 흘리는 이벤트의 타입.
//
// **출처는 문서가 아니라 실측이다** (opencode 1.17.18, 2026-08-11 캡처).
//
// ⚠️ opencode 에는 API 가 **두 벌** 있고, 어느 쪽으로 프롬프트를 넣었는지에 따라
//    흘러나오는 이벤트 계열이 **통째로 다르다**:
//
//      POST /session/:id/prompt_async (레거시) → `message.part.updated` / `message.part.delta`
//      POST /api/session/:id/prompt   (신규)   → `session.next.*`
//
//    **지금 우리가 쓰는 것은 레거시다** (2026-08-14 전환 — 신규 경로가 LLM 요청에 MCP
//    도구를 안 실어서다. 근거는 `legacyEvents.ts` 머리말). 계열이 어긋나게 짜면
//    핸드셰이크는 통과하는데 채팅 청크가 **한 개도 안 잡힌다** (실제로 겪은 실패다).
//
//    ⚠️ **그런데 이 파일의 이름들은 여전히 `session.next.*` 다 — 일부러 그렇다.**
//    레거시 이벤트는 `legacyEvents.ts` 가 신규 이름으로 되옮긴 뒤 `translate.ts` 에
//    들어온다. 매핑의 정본을 한 벌로 두려는 것이고, 그래서 이 파일은 **어댑터 안쪽의
//    공용 이벤트 모양**이지 더 이상 "와이어에서 오는 그대로" 가 아니다.
//    와이어 실물을 보려면 `legacyEvents.ts` 를 봐라.
//
// 봉투가 `data` 가 아니라 **`properties`** 인 것도 실측 결과다.

export interface OpencodeEvent<TProps = Record<string, unknown>> {
  id: string
  type: string
  properties: TProps
}

export const OpencodeEventType = {
  SERVER_CONNECTED: 'server.connected',
  STEP_STARTED: 'session.next.step.started',
  STEP_ENDED: 'session.next.step.ended',
  /**
   * ⚠️ **중단(`POST …/interrupt`)의 종료 신호가 이것이다 — `step.ended` 가 아니다.**
   * 1.18.18 실측(2026-08-14): 턴 도중 interrupt 를 넣으면 204 뒤에 딱 두 건이 온다.
   *   `session.next.text.ended` → `session.next.step.failed`
   *     `{sessionID, assistantMessageID, error:{type:"unknown", message:"Provider turn interrupted"}}`
   * `step.ended` 는 **끝내 오지 않는다.** 이 이벤트를 안 번역하면 취소한 턴을 닫는 것은
   * TurnGate 의 5초 강제 종단뿐이라, 사용자에겐 "중단이 무시됐다" 로 보인다.
   */
  STEP_FAILED: 'session.next.step.failed',
  TEXT_DELTA: 'session.next.text.delta',
  REASONING_DELTA: 'session.next.reasoning.delta',
  TOOL_INPUT_STARTED: 'session.next.tool.input.started',
  TOOL_SUCCESS: 'session.next.tool.success',
  TOOL_FAILED: 'session.next.tool.failed',
  SESSION_IDLE: 'session.idle',
  SESSION_ERROR: 'session.error',
  PERMISSION_ASKED: 'permission.asked',
  PERMISSION_V2_ASKED: 'permission.v2.asked',
  QUESTION_ASKED: 'question.asked',
  QUESTION_V2_ASKED: 'question.v2.asked',
} as const

/** 모든 session.next.* 이벤트가 공유하는 필드 */
export interface StepScoped {
  sessionID: string
  assistantMessageID?: string
  timestamp?: string
}

export interface StepStartedProps extends StepScoped {
  agent?: string
  model?: { id: string; providerID: string }
}

/**
 * `finish` 가 턴의 계속 여부를 가른다.
 *   `tool-calls` — 도구를 부르려고 끊긴 것이다. **다음 step 이 이어진다** (턴 안 끝남)
 *   그 외(`stop`·`length`·…) — 턴 종료
 */
export interface StepEndedProps extends StepScoped {
  finish?: string
  cost?: number
  tokens?: { input?: number; output?: number; reasoning?: number }
}

/**
 * 실패로 끝난 step. `finish` 도 `tokens` 도 없고 `error` 하나뿐이다 (실측).
 * 중단으로 끝난 턴도 이 모양으로 온다 — 그래서 "실패" 로 단정해 옮기면 안 된다
 * (`translate.ts` 의 STEP_FAILED 분기).
 */
export interface StepFailedProps extends StepScoped {
  error?: { type?: string; message?: string }
}

/** 텍스트·추론 델타. textID 는 메시지 안에서만 유일하다 (`text-0` 이 매번 재사용된다). */
export interface TextDeltaProps extends StepScoped {
  textID?: string
  delta: string
}

export interface ToolInputStartedProps extends StepScoped {
  callID: string
  /** 도구 이름. 이 시점에 이미 알 수 있다 — 인자 스트리밍보다 먼저 온다 */
  name: string
}

export interface ToolResultProps extends StepScoped {
  callID: string
  tool?: string
  output?: unknown
  structured?: unknown
  error?: unknown
}

export interface PermissionAskedProps {
  sessionID: string
  id: string
  /** 무엇을 하려는지 (도구명에 대응) */
  action?: string
  resources?: string[]
  title?: string
}

export interface QuestionAskedProps {
  sessionID: string
  id: string
  question?: string
  text?: string
}

/**
 * SSE 한 줄 → 이벤트.
 *
 * ⚠️ **페이로드가 실린 필드 이름이 스트림마다 다르다** (실측):
 *     `/api/event` → `data`        (OpenAPI 정본)
 *     `/event`     → `properties`  (레거시. **우리가 쓰는 쪽** — `client.ts` 의 `eventUrl`)
 *
 * 둘 다 받아 `properties` 로 통일한다. 이걸 안 맞추면 파싱은 성공하는데 필드가 전부
 * undefined 가 되어, 청크는 오는데 **내용이 빈** 상태가 된다 — `{"messageType":"tool_call"}`
 * 처럼 도구 이름도 결과도 없이 흐른다. 실제로 겪은 증상이다.
 */
export function parseEvent(raw: string): OpencodeEvent | null {
  const trimmed = raw.startsWith('data:') ? raw.slice(5).trim() : raw.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed === null || typeof parsed !== 'object') return null
    const candidate = parsed as Record<string, unknown>
    if (typeof candidate['type'] !== 'string') return null
    const payload = candidate['data'] ?? candidate['properties'] ?? {}
    return { ...candidate, properties: payload } as unknown as OpencodeEvent
  } catch {
    return null
  }
}
