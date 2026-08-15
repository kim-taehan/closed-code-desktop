import { OpencodeEventType, type OpencodeEvent } from './events'

// 레거시 이벤트 계열 → 신규(`session.next.*`) 계열로 되옮긴다.
//
// ## 왜 레거시 세대를 쓰는가 (전환의 근거 — 정본)
//
// opencode 에는 API 가 두 벌 있고, **채팅 계열은 일부러 레거시(`/api` 없는) 쪽에 선다.**
// 이유는 MCP 하나다: 신규 v2 경로는 LLM 요청의 `tools` 배열에 **MCP 도구를 안 싣는다.**
// 목 LLM 으로 요청 본문을 통째로 받아 비교한 캡처(1.18.18, 같은 서버·같은 세션·같은 MCP
// 등록 상태)가 근거다:
//
//   레거시 프롬프트 → tools 12개: bash edit glob grep **probe_probe_tool** question read
//                                 skill task todowrite webfetch write
//   신규 프롬프트   → tools 12개: apply_patch bash edit glob grep question read skill
//                                 todowrite webfetch websearch write   ← MCP 도구만 없다
//
// 신규 경로 본문에는 tools 를 넣을 필드 자체가 없어 클라이언트가 우회할 방법도 없다.
// 데스크톱이 제 화면 상태를 모델에게 주는 길(`electron/mcp/`)이 통째로 죽어 있던 원인이 이것이다.
// MCP 도구는 싣기만 하는 것이 아니라 **실제로 실행되고 결과가 회수된다** (목 MCP 서버에
// `tools/call` 도착, `state.output` 으로 회수 확인).
//
// ## 세 곳이 한 세트다
//
// 프롬프트·중단·이벤트 스트림은 **세대가 같아야 한다** (`client.ts` 의 각 자리에 실측을 적어 뒀다).
// 하나만 옮기면 조용히 반쯤 죽는다 — 프롬프트만 레거시로 보내고 `/api/event` 를 구독하면
// 그 스트림에는 `session.created` 와 **사용자 메시지 에코**까지 와서 연결도 핸드셰이크도
// 멀쩡해 보이는데, 어시스턴트 턴이 한 건도 안 온다 (같은 턴 동시 측정: `/event` 44건 ·
// `/api/event` 6건).
//
// ## 매핑 (전부 1.18.18 실측 캡처)
//
//   레거시                                            신규(이 파일이 만들어 내는 이름)
//   message.part.updated  part.type="step-start"   →  session.next.step.started
//   message.part.updated  part.type="step-finish"  →  session.next.step.ended  (reason→finish)
//   message.part.delta    field="text"             →  session.next.text.delta
//   message.part.delta    field="reasoning"        →  session.next.reasoning.delta
//   message.part.updated  part.type="tool"         →  상태(state.status)에 따라 셋으로 갈린다
//        status="pending"                          →  session.next.tool.input.started
//        status="completed"                        →  session.next.tool.success
//        status="error"                            →  session.next.tool.failed
//   session.idle · session.error · permission.asked · question.asked → 이름이 같다 (그대로 통과)
//
// **턴 종결자의 세션 격리 근거 (2026-08-15 실측, 1.18.18 원시 프레임):** 이 전환으로 턴을
// 닫는 권한이 session.idle 로 옮겨 갔는데, transport 의 sessionID 필터는 필드가 없으면
// 통과시키는(fail-open) 구조다. 그래서 원시 프레임을 떠서 확인했다 — 둘 다 싣는다:
//   {"type":"session.idle","properties":{"sessionID":"ses_ffc4cf317ffe…"}}
//   {"type":"session.error","properties":{"sessionID":"ses_ffc4cf70fff…","error":{…}}}
// 같은 서버의 두 세션으로 B idle 이 A 턴 진행 중에 오는 시나리오까지 만들었고, B 의 idle 은
// B 의 id 를 달고 와서 A 는 계속 흘렀다. 이 근거가 깨지는 버전을 만나면 legacyEvents 는
// 채워 줄 수 없으므로(전역 스트림이라 정보 자체가 없다) transport 쪽 방어가 필요해진다.
//
// **되옮기는 쪽을 고른 이유:** 매핑의 정본은 `translate.ts` 하나로 두고 싶어서다. 레거시
// 이벤트에서 davis 봉투로 곧장 가는 두 번째 번역기를 만들면 청크 규칙이 두 벌이 되고,
// 한쪽만 고치는 사고가 난다. 여기서는 **이름과 필드만** 바꾸고 davis 쪽 판단(턴을 언제
// 닫나·취소를 실패로 볼 것인가)은 전부 `translate.ts` 에 남긴다.

/** 레거시 스트림에만 있는 이벤트 이름 */
export const LegacyEventType = {
  MESSAGE_PART_UPDATED: 'message.part.updated',
  MESSAGE_PART_DELTA: 'message.part.delta',
} as const

/**
 * `message.part.updated` 의 part.
 *
 * ⚠️ **도구는 같은 `part.id` 로 상태만 바꿔 3번 온다** (pending→running→completed).
 * 델타가 아니라 **덮어쓰기**다 — 이어붙이면 인자가 여러 번 들어간다.
 */
interface LegacyPart {
  id?: string
  type?: string
  messageID?: string
  text?: string
  /** step-finish 의 종료 사유. 신규의 `finish` 와 값이 같다 (`tool-calls`·`stop`) */
  reason?: string
  tokens?: { input?: number; output?: number; reasoning?: number }
  /** 도구 이름. 신규는 `name`(input.started) / `tool`(결과) 로 갈리는데 레거시는 이것 하나다 */
  tool?: string
  callID?: string
  state?: {
    status?: string
    input?: unknown
    /** 레거시 결과는 문자열 하나다 — 신규의 `output`/`structured` 두 갈래가 아니다 */
    output?: unknown
    error?: unknown
  }
}

interface PartUpdatedProps {
  sessionID?: string
  part?: LegacyPart
}

interface PartDeltaProps {
  sessionID?: string
  messageID?: string
  partID?: string
  /** 어느 필드가 자라는가. `text` 와 `reasoning` 을 이걸로 가른다 */
  field?: string
  delta?: string
}

function renamed(event: OpencodeEvent, type: string, properties: Record<string, unknown>): OpencodeEvent {
  return { id: event.id, type, properties }
}

function fromPartDelta(event: OpencodeEvent): OpencodeEvent | null {
  const props = event.properties as unknown as PartDeltaProps
  if (!props.delta) return null
  const type =
    props.field === 'reasoning' ? OpencodeEventType.REASONING_DELTA : OpencodeEventType.TEXT_DELTA
  return renamed(event, type, {
    sessionID: props.sessionID,
    assistantMessageID: props.messageID,
    // 신규의 textID 자리. partID 는 메시지 안에서 유일해 버블 묶기 키로 그대로 쓴다
    // (`translate.ts` 의 segmentId 가 assistantMessageID 와 합쳐 쓴다).
    textID: props.partID,
    delta: props.delta,
  })
}

function fromToolPart(event: OpencodeEvent, sessionID: string | undefined, part: LegacyPart): OpencodeEvent | null {
  const base = {
    sessionID,
    assistantMessageID: part.messageID,
    callID: part.callID,
    tool: part.tool,
  }
  switch (part.state?.status) {
    case 'pending':
      // 이 시점에 이미 이름을 안다 — 인자 스트리밍을 기다리지 않고 도구 카드를 띄운다.
      return renamed(event, OpencodeEventType.TOOL_INPUT_STARTED, { ...base, name: part.tool })
    case 'completed':
      return renamed(event, OpencodeEventType.TOOL_SUCCESS, { ...base, output: part.state.output })
    case 'error':
      return renamed(event, OpencodeEventType.TOOL_FAILED, { ...base, error: part.state.error })
    // `running` 은 인자가 확정됐다는 뜻뿐이라 davis 쪽에 대응 청크가 없다. 버린다 —
    // 옮기면 같은 callID 의 도구 카드가 두 번 뜬다.
    default:
      return null
  }
}

function fromPartUpdated(event: OpencodeEvent): OpencodeEvent | null {
  const props = event.properties as unknown as PartUpdatedProps
  const part = props.part
  if (!part) return null

  switch (part.type) {
    case 'step-start':
      return renamed(event, OpencodeEventType.STEP_STARTED, {
        sessionID: props.sessionID,
        assistantMessageID: part.messageID,
      })
    case 'step-finish':
      return renamed(event, OpencodeEventType.STEP_ENDED, {
        sessionID: props.sessionID,
        assistantMessageID: part.messageID,
        finish: part.reason,
        ...(part.tokens ? { tokens: part.tokens } : {}),
      })
    case 'tool':
      return fromToolPart(event, props.sessionID, part)
    // `text` 파트의 갱신은 버린다. 글은 `message.part.delta` 로 이미 흐르고 있고,
    // 이것은 **완성본을 다시 주는 것**이라 옮기면 답이 두 번 찍힌다.
    // 사용자가 방금 보낸 메시지의 에코도 이 모양으로 와서, 옮기면 제 말이 답으로도 뜬다.
    default:
      return null
  }
}

/**
 * 승인 요청은 **이름은 같은데 필드 이름이 다르다.**
 *
 * 레거시 실측(1.18.18, `permission: {bash:"ask"}` 를 걸고 도구를 부르게 해서 받았다):
 *   `{id, sessionID, permission:"bash", patterns:["echo hi"], metadata:{command},
 *     always:["echo *"], tool:{messageID, callID}}`
 *
 * `translate.ts` 는 신규 이름(`action`·`resources`)을 읽으므로 그 자리를 채워 준다.
 * 안 채우면 승인 카드의 도구 이름이 **"알 수 없는 도구"** 로 뜬다 — 무엇을 승인하는지
 * 안 보이는 채로 사용자에게 예/아니오를 묻게 된다.
 *
 * 이미 신규 이름이 실려 있으면 건드리지 않는다. 두 세대가 같은 이벤트 이름을 쓰는
 * 자리라, 덮어쓰면 신규 쪽이 조용히 망가진다.
 */
function fromPermissionAsked(event: OpencodeEvent): OpencodeEvent {
  const props = event.properties as Record<string, unknown>
  if (props['action'] !== undefined && props['resources'] !== undefined) return event
  return {
    ...event,
    properties: {
      ...props,
      ...(props['action'] === undefined && typeof props['permission'] === 'string'
        ? { action: props['permission'] }
        : {}),
      ...(props['resources'] === undefined && Array.isArray(props['patterns'])
        ? { resources: props['patterns'] }
        : {}),
    },
  }
}

/**
 * 질문도 **이름은 같은데 모양이 다르다.**
 *
 * 레거시 실측(1.18.18, 내장 `question` 도구를 부르게 해서 받았다):
 *   `{id, sessionID, questions:[{question, header, options:[{label, description}]}],
 *     tool:{messageID, callID}}`
 *
 * `translate.ts` 는 평평한 `question`/`text` 를 읽으므로 **글이 `questions[0]` 안에 있으면
 * 못 찾고 질문 카드가 빈 채로 뜬다.** 첫 질문의 글을 그 자리에 올려 준다.
 *
 * 한계: davis 의 질문 카드는 하나만 묻는다. 여럿이 와도 첫 질문만 보이고, 답신도
 * 첫 질문에만 간다 (`legacyChat.ts` 의 `replyQuestionLegacy`). 실측한 것도 하나짜리다.
 */
function fromQuestionAsked(event: OpencodeEvent): OpencodeEvent {
  const props = event.properties as Record<string, unknown>
  if (typeof props['question'] === 'string' || typeof props['text'] === 'string') return event
  const questions = props['questions']
  const first = Array.isArray(questions) ? (questions[0] as Record<string, unknown> | undefined) : undefined
  if (first === undefined || typeof first['question'] !== 'string') return event
  return { ...event, properties: { ...props, question: first['question'] } }
}

/**
 * 레거시 이벤트면 신규 이름으로 되옮기고, 아니면 그대로 돌려준다.
 * 옮길 수 없는 것(중간 상태·에코)은 `null` — 부르는 쪽이 버린다.
 */
export function normalizeLegacyEvent(event: OpencodeEvent): OpencodeEvent | null {
  switch (event.type) {
    case LegacyEventType.MESSAGE_PART_DELTA:
      return fromPartDelta(event)
    case LegacyEventType.MESSAGE_PART_UPDATED:
      return fromPartUpdated(event)
    case OpencodeEventType.PERMISSION_ASKED:
      return fromPermissionAsked(event)
    case OpencodeEventType.QUESTION_ASKED:
      return fromQuestionAsked(event)
    default:
      return event
  }
}
