import type { PromptContext } from './FakeOpencodeServer'

// 턴 대본 — 실물 opencode 가 **레거시 `/event`** 로 흘리는 순서를 그대로 따른다.
// (실측 캡처 기준: opencode 1.18.18, 2026-08-14. 목 LLM 으로 도구 호출까지 재현해 받았다)
//
// 대본을 지어내지 않는 것이 중요하다. 순서·필드명이 실물과 어긋나면 어댑터가 틀려도
// 테스트는 초록으로 남는다.
//
// ⚠️ **여기 이름은 `session.next.*` 가 아니다.** 예전 대본은 신규 계열을 흉내냈고,
// 채팅 경로를 레거시로 옮기면서 같이 옮겼다. 레거시 이벤트를 신규 이름으로 되옮기는
// `legacyEvents.ts` 를 **실제로 지나가게 하는 것**이 이 대본의 값이다 — 신규 이름으로
// 두면 그 모듈을 한 번도 안 밟고 초록이 난다.
//
// 실물의 결이 몇 개 더 있는데 일부러 뺐다 (`session.status`·`session.diff`·
// `message.updated`·사용자 메시지 에코). 어댑터가 전부 버리는 것들이라 대본을 읽기
// 어렵게만 만든다. **버린다는 사실 자체를 재려면** 그때 여기에 더한다.

type Event = Record<string, unknown>

function event(type: string, data: Record<string, unknown>): Event {
  return { type, data }
}

/** `message.part.updated` 한 건. 실물은 파트를 통째로 다시 준다 (델타가 아니다). */
function partUpdated(sessionID: string, part: Record<string, unknown>): Event {
  return event('message.part.updated', { sessionID, part, time: 1786693410337 })
}

export function stepStarted(sessionID: string, messageID: string): Event {
  return partUpdated(sessionID, {
    id: `prt_start_${messageID}`,
    messageID,
    sessionID,
    type: 'step-start',
    snapshot: '7a2af710e9eb8c54b1a863671152a67bc19b586d',
  })
}

/**
 * 텍스트는 델타로 쪼개 온다 — 화면 누적을 실물처럼 검증하려면 한 덩어리로 주면 안 된다.
 *
 * 실물 순서: 빈 text 파트가 먼저 생기고(`text:""`), 델타가 흐르고, **완성본이 다시 온다.**
 * 마지막 완성본을 그대로 옮기면 답이 두 번 찍히므로 어댑터가 버려야 한다 —
 * 그 자리를 재려고 일부러 넣어 둔다.
 */
export function textDeltas(sessionID: string, messageID: string, text: string, partID = 'prt_text_0'): Event[] {
  const words = text.split(' ')
  return [
    partUpdated(sessionID, { id: partID, messageID, sessionID, type: 'text', text: '', time: { start: 1 } }),
    ...words.map((word, index) =>
      event('message.part.delta', {
        sessionID,
        messageID,
        partID,
        field: 'text',
        delta: index === 0 ? word : ` ${word}`,
      }),
    ),
    partUpdated(sessionID, { id: partID, messageID, sessionID, type: 'text', text, time: { start: 1, end: 2 } }),
  ]
}

/** 추론 델타. 갈라내는 것은 이벤트 이름이 아니라 **`field`** 다 (실물). */
export function reasoningDeltas(sessionID: string, messageID: string, text: string): Event[] {
  return text.split(' ').map((word, index) =>
    event('message.part.delta', {
      sessionID,
      messageID,
      partID: 'prt_reasoning_0',
      field: 'reasoning',
      delta: index === 0 ? word : ` ${word}`,
    }),
  )
}

/**
 * 도구 한 번.
 *
 * ⚠️ **같은 `part.id` 로 상태만 바꿔 세 번 온다** (pending→running→completed) — 실물 그대로다.
 * 이름(`part.tool`)은 pending 때 이미 실려 있어 어댑터가 그 시점에 도구 카드를 띄운다.
 * `running` 은 인자 확정일 뿐이라 대응 청크가 없다 — 옮기면 카드가 두 번 뜬다.
 */
export function toolCall(sessionID: string, messageID: string, name: string, callID: string): Event[] {
  const id = `prt_tool_${callID}`
  const base = { id, messageID, sessionID, type: 'tool', tool: name, callID }
  return [
    partUpdated(sessionID, { ...base, state: { status: 'pending', input: {}, raw: '' } }),
    partUpdated(sessionID, { ...base, state: { status: 'running', input: { ok: true }, time: { start: 1 } } }),
    partUpdated(sessionID, {
      ...base,
      state: {
        status: 'completed',
        input: { ok: true },
        // 레거시 결과는 **문자열 하나**다 — 신규의 `output`/`structured` 두 갈래가 아니다.
        output: `${name} ran`,
        metadata: { truncated: false },
        title: '',
        time: { start: 1, end: 2 },
      },
    }),
  ]
}

/**
 * step 종료. `reason` 이 턴의 계속 여부를 가른다 —
 * `tool-calls` 면 다음 step 이 이어지고, 그 외면 턴이 끝난다.
 * (값은 신규의 `finish` 와 같은 문자열이다 — 실측으로 확인했다.)
 */
export function stepEnded(sessionID: string, messageID: string, reason = 'stop'): Event {
  return partUpdated(sessionID, {
    id: `prt_finish_${messageID}_${reason}`,
    messageID,
    sessionID,
    type: 'step-finish',
    reason,
    tokens: { input: 100, output: 10 },
  })
}

/**
 * 턴을 닫는 마지막 이벤트.
 *
 * **레거시에서는 이게 실제로 온다.** 신규 경로에서 `step.ended` 뒤에 idle 이 끝내 안 와
 * TurnGate 의 5초 강제 종단에 기대던 문제가 여기엔 없다 (실측).
 */
export function sessionIdle(sessionID: string): Event {
  return event('session.idle', { sessionID })
}

/**
 * 승인을 묻는 도구 대본.
 *
 * `permission.asked` 의 필드 이름이 **실물 레거시 그대로**인 것이 핵심이다 —
 * `permission`/`patterns` 이고 신규의 `action`/`resources` 가 **없다**. 신규 이름으로
 * 적어 두면 `legacyEvents.ts` 의 매핑을 안 밟고 초록이 난다 (승인 카드가 실물에서는
 * "알 수 없는 도구" 로 뜨는데 테스트는 통과하는 상태가 된다).
 */
export function approvalTurnScript(context: PromptContext): Event[] {
  const messageID = `msg_${context.sessionID}`
  const callID = `call_${context.sessionID}`
  return [
    stepStarted(context.sessionID, messageID),
    event('permission.asked', {
      id: `per_${context.sessionID}`,
      sessionID: context.sessionID,
      permission: 'bash',
      patterns: ['echo hi'],
      metadata: { command: 'echo hi' },
      always: ['echo *'],
      tool: { messageID, callID },
    }),
  ]
}

/**
 * 질문을 던지는 도구 대본.
 *
 * ⚠️ **글이 `questions[0]` 안에 있고 평평한 `question` 이 없는 것이 핵심이다** — 실물
 * 레거시가 그렇다. 평평하게 적어 두면 `fromQuestionAsked` 를 안 밟고 초록이 나는데,
 * 실물에서는 질문 카드가 **빈 채로** 뜬다.
 */
export function questionTurnScript(context: PromptContext): Event[] {
  const messageID = `msg_${context.sessionID}`
  return [
    stepStarted(context.sessionID, messageID),
    event('question.asked', {
      id: `que_${context.sessionID}`,
      sessionID: context.sessionID,
      questions: [
        {
          question: '어느 쪽으로 갈까요?',
          header: '방향',
          options: [
            { label: '왼쪽', description: '왼쪽으로' },
            { label: '오른쪽', description: '오른쪽으로' },
          ],
        },
      ],
      tool: { messageID, callID: `call_${context.sessionID}` },
    }),
  ]
}

/** 기본 대본: 텍스트 한 번 답하고 끝난다. 프롬프트를 그대로 되돌려 격리 검증에 쓴다. */
export function turnScript(context: PromptContext): Event[] {
  const messageID = `msg_${context.sessionID}`
  return [
    stepStarted(context.sessionID, messageID),
    ...textDeltas(context.sessionID, messageID, `답: ${context.text}`),
    stepEnded(context.sessionID, messageID),
    sessionIdle(context.sessionID),
  ]
}

/** 도구를 한 번 쓰고 답하는 두 step 짜리 대본 */
export function toolTurnScript(context: PromptContext): Event[] {
  const first = `msg_${context.sessionID}_1`
  const second = `msg_${context.sessionID}_2`
  return [
    stepStarted(context.sessionID, first),
    ...reasoningDeltas(context.sessionID, first, '파일을 읽자'),
    ...toolCall(context.sessionID, first, 'read', `call_${context.sessionID}`),
    stepEnded(context.sessionID, first, 'tool-calls'),
    stepStarted(context.sessionID, second),
    ...textDeltas(context.sessionID, second, `답: ${context.text}`, 'prt_text_1'),
    stepEnded(context.sessionID, second),
    sessionIdle(context.sessionID),
  ]
}
