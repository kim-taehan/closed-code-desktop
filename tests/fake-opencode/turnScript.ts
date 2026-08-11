import type { PromptContext } from './FakeOpencodeServer'

// 턴 대본 — 실물 opencode 가 `/api/event` 로 흘리는 `session.next.*` 순서를 그대로 따른다.
// (실측 캡처 기준: opencode 1.17.18, 2026-08-11)
//
// 대본을 지어내지 않는 것이 중요하다. 순서·필드명이 실물과 어긋나면 어댑터가 틀려도
// 테스트는 초록으로 남는다.

type Event = Record<string, unknown>

function event(type: string, data: Record<string, unknown>): Event {
  return { type, data }
}

export function stepStarted(sessionID: string, messageID: string): Event {
  return event('session.next.step.started', {
    sessionID,
    assistantMessageID: messageID,
    agent: 'build',
    model: { id: 'fake-model', providerID: 'fake' },
  })
}

/** 텍스트는 델타로 쪼개 온다 — 화면 누적을 실물처럼 검증하려면 한 덩어리로 주면 안 된다. */
export function textDeltas(sessionID: string, messageID: string, text: string, textID = 'text-0'): Event[] {
  return [
    event('session.next.text.started', { sessionID, assistantMessageID: messageID, textID }),
    ...text.split(' ').map((word, index) =>
      event('session.next.text.delta', {
        sessionID,
        assistantMessageID: messageID,
        textID,
        delta: index === 0 ? word : ` ${word}`,
      }),
    ),
    event('session.next.text.ended', { sessionID, assistantMessageID: messageID, textID, text }),
  ]
}

export function reasoningDeltas(sessionID: string, messageID: string, text: string): Event[] {
  return text
    .split(' ')
    .map((word, index) =>
      event('session.next.reasoning.delta', {
        sessionID,
        assistantMessageID: messageID,
        textID: 'reasoning-0',
        delta: index === 0 ? word : ` ${word}`,
      }),
    )
}

/** 도구 한 번. 이름은 input.started 에서 이미 온다 (어댑터가 그 시점에 tool_call 을 낸다). */
export function toolCall(sessionID: string, messageID: string, name: string, callID: string): Event[] {
  return [
    event('session.next.tool.input.started', { sessionID, assistantMessageID: messageID, callID, name }),
    event('session.next.tool.called', { sessionID, assistantMessageID: messageID, callID, tool: name }),
    event('session.next.tool.success', {
      sessionID,
      assistantMessageID: messageID,
      callID,
      tool: name,
      structured: { ok: true },
    }),
  ]
}

/**
 * step 종료. `finish` 가 턴의 계속 여부를 가른다 —
 * `tool-calls` 면 다음 step 이 이어지고, 그 외면 턴이 끝난다.
 */
export function stepEnded(sessionID: string, messageID: string, finish = 'stop'): Event {
  return event('session.next.step.ended', {
    sessionID,
    assistantMessageID: messageID,
    finish,
    tokens: { input: 100, output: 10 },
  })
}

/** 기본 대본: 텍스트 한 번 답하고 끝난다. 프롬프트를 그대로 되돌려 격리 검증에 쓴다. */
export function turnScript(context: PromptContext): Event[] {
  const messageID = `msg_${context.sessionID}`
  return [
    stepStarted(context.sessionID, messageID),
    ...textDeltas(context.sessionID, messageID, `답: ${context.text}`),
    stepEnded(context.sessionID, messageID),
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
    ...textDeltas(context.sessionID, second, `답: ${context.text}`),
    stepEnded(context.sessionID, second),
  ]
}
