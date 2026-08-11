import { describe, expect, it } from 'vitest'
import { translate, type TranslateContext } from './translate'
import { parseEvent, type OpencodeEvent } from './events'

// 입력은 **실제로 캡처한 페이로드**다 (opencode 1.17.18, `GET /event`, 2026-08-11).
// 손으로 지어낸 모양으로 테스트하면 어댑터가 실물과 어긋나도 초록으로 남는다 —
// 실제로 레거시 계열(`message.part.*`)로 짰다가 채팅이 한 건도 안 잡힌 적이 있다.

const CTX: TranslateContext = { streamId: 'st1' }
const SES = 'ses_010960d2fffeOGjyfEtpZBB4H0'
const MSG = 'msg_fef69f4b5001Y0bs4J3svrEbjz'

function event(type: string, properties: Record<string, unknown>): OpencodeEvent {
  return { id: 'evt_1', type, properties: { sessionID: SES, ...properties } }
}

function dataOf(frame: unknown): Record<string, unknown> {
  return (frame as { data: Record<string, unknown> }).data
}

describe('parseEvent', () => {
  it('SSE data 줄을 벗겨 파싱한다', () => {
    expect(parseEvent('data: {"id":"e","type":"server.connected","properties":{}}')?.type).toBe(
      'server.connected',
    )
  })

  // 페이로드 필드 이름이 스트림마다 다르다: `/api/event` 는 data, 레거시 `/event` 는 properties.
  // 안 맞추면 파싱은 되는데 필드가 전부 undefined 가 되어 "내용 없는 청크"가 흐른다.
  it('/api/event 의 data 를 페이로드로 읽는다', () => {
    const parsed = parseEvent('data: {"id":"e","type":"session.next.text.delta","data":{"delta":"안"}}')
    expect(parsed?.properties).toEqual({ delta: '안' })
  })

  it('레거시 /event 의 properties 도 읽는다', () => {
    const parsed = parseEvent('{"id":"e","type":"x","properties":{"delta":"녕"}}')
    expect(parsed?.properties).toEqual({ delta: '녕' })
  })

  it('둘 다 없으면 빈 객체를 채운다', () => {
    expect(parseEvent('{"id":"e","type":"x"}')?.properties).toEqual({})
  })

  it('JSON 이 아니면 null 이다 (하트비트·주석 줄)', () => {
    expect(parseEvent(': keep-alive')).toBeNull()
    expect(parseEvent('data: not json')).toBeNull()
  })
})

describe('핸드셰이크', () => {
  it('server.connected → system/connected', () => {
    expect(translate(event('server.connected', {}), CTX)[0]).toEqual({
      kind: 'system',
      action: 'connected',
      data: {},
    })
  })
})

describe('턴 경계', () => {
  it('step.started → turn_start (turnId 는 assistantMessageID)', () => {
    const [frame] = translate(
      event('session.next.step.started', {
        agent: 'build',
        model: { id: 'glm-5.2', providerID: 'davis-litellm' },
        assistantMessageID: MSG,
      }),
      CTX,
    )
    expect(dataOf(frame)).toEqual({ messageType: 'turn_start', turnId: MSG })
  })

  it('finish=tool-calls 는 턴을 닫지 않는다 — 다음 step 이 이어진다', () => {
    expect(
      translate(
        event('session.next.step.ended', { assistantMessageID: MSG, finish: 'tool-calls' }),
        CTX,
      ),
    ).toEqual([])
  })

  it('finish=stop 은 turn_end + stream_end 로 턴을 닫는다', () => {
    const frames = translate(
      event('session.next.step.ended', {
        assistantMessageID: MSG,
        finish: 'stop',
        tokens: { input: 3560, output: 3 },
      }),
      CTX,
    )
    expect(frames).toHaveLength(2)
    expect(dataOf(frames[0])).toMatchObject({ messageType: 'turn_end', terminal: true })
    expect(frames[1]).toMatchObject({
      action: 'stream_end',
      data: { terminal: true, tokenUsage: { input: 3560, output: 3 } },
    })
  })

  it('session.idle 도 턴을 닫는다 (폴백 경로)', () => {
    const frames = translate(event('session.idle', {}), CTX)
    expect(frames[1]).toMatchObject({ action: 'stream_end' })
  })
})

describe('텍스트·추론', () => {
  it('text.delta → TEXT, segmentId 는 메시지ID:textID 다', () => {
    const [frame] = translate(
      event('session.next.text.delta', { assistantMessageID: MSG, textID: 'text-0', delta: 'The' }),
      CTX,
    )
    expect(dataOf(frame)).toEqual({
      messageType: 'text',
      message: 'The',
      segmentId: `${MSG}:text-0`,
    })
  })

  it('textID 만으로 묶지 않는다 — text-0 은 메시지마다 재사용된다', () => {
    const a = translate(
      event('session.next.text.delta', { assistantMessageID: 'msg_A', textID: 'text-0', delta: 'a' }),
      CTX,
    )
    const b = translate(
      event('session.next.text.delta', { assistantMessageID: 'msg_B', textID: 'text-0', delta: 'b' }),
      CTX,
    )
    expect(dataOf(a[0])['segmentId']).not.toBe(dataOf(b[0])['segmentId'])
  })

  it('reasoning.delta → THINKING, segmentId 없이', () => {
    const [frame] = translate(
      event('session.next.reasoning.delta', { assistantMessageID: MSG, textID: 'r-0', delta: 'Let' }),
      CTX,
    )
    expect(dataOf(frame)).toEqual({ messageType: 'thinking', message: 'Let' })
  })

  it('빈 델타는 버린다', () => {
    expect(translate(event('session.next.text.delta', { delta: '' }), CTX)).toEqual([])
  })
})

describe('도구', () => {
  it('tool.input.started 에서 tool_call 을 낸다 — 이때 이미 이름을 안다', () => {
    const [frame] = translate(
      event('session.next.tool.input.started', {
        assistantMessageID: MSG,
        callID: 'chatcmpl-tool-849aa8b94654fc02',
        name: 'read',
      }),
      CTX,
    )
    expect(dataOf(frame)).toEqual({
      messageType: 'tool_call',
      toolName: 'read',
      toolCallId: 'chatcmpl-tool-849aa8b94654fc02',
    })
  })

  it('tool.success → tool_result (structured 를 결과로 싣는다)', () => {
    const [frame] = translate(
      event('session.next.tool.success', {
        callID: 'call_1',
        structured: { name: 'sample.txt', content: 'hello' },
      }),
      CTX,
    )
    expect(dataOf(frame)).toMatchObject({
      messageType: 'tool_result',
      toolCallId: 'call_1',
      success: true,
      result: { name: 'sample.txt', content: 'hello' },
    })
  })

  it('tool.failed → success=false 와 사유', () => {
    const [frame] = translate(
      event('session.next.tool.failed', { callID: 'call_1', error: '파일 없음' }),
      CTX,
    )
    expect(dataOf(frame)).toMatchObject({ messageType: 'tool_result', success: false, error: '파일 없음' })
  })
})

describe('인터럽트', () => {
  it('permission.v2.asked → 승인 카드', () => {
    const [frame] = translate(
      event('permission.v2.asked', {
        id: 'per_1',
        action: 'bash',
        title: '명령 실행',
        resources: ['rm -rf /tmp/x'],
      }),
      CTX,
    )
    expect(dataOf(frame)).toEqual({
      messageType: 'tool_approval_request',
      requestId: 'per_1',
      toolName: 'bash',
      displayName: '명령 실행',
      args: { resources: ['rm -rf /tmp/x'] },
    })
  })

  it('question.v2.asked → 사용자 질문 (HIL)', () => {
    const [frame] = translate(
      event('question.v2.asked', { id: 'que_1', question: '어느 파일을 고칠까요?' }),
      CTX,
    )
    expect(dataOf(frame)).toEqual({
      messageType: 'user_question',
      questionId: 'que_1',
      question: '어느 파일을 고칠까요?',
    })
  })
})

describe('오류', () => {
  it('session.error 는 error 청크 + 실패 stream_end 다', () => {
    const frames = translate(
      event('session.error', { error: { name: 'UnknownError', data: { message: '터졌다' } } }),
      CTX,
    )
    expect(dataOf(frames[0])).toEqual({ messageType: 'error', message: '터졌다' })
    expect(frames[1]).toMatchObject({ action: 'stream_end', data: { failed: true } })
  })
})

describe('모르는 이벤트', () => {
  it('조용히 버린다 — 잡음이 많다 (plugin.added·heartbeat·prompt.admitted…)', () => {
    for (const type of ['plugin.added', 'server.heartbeat', 'session.next.prompted', 'session.status']) {
      expect(translate(event(type, {}), CTX)).toEqual([])
    }
  })

  it('레거시 계열(message.part.*)은 번역하지 않는다 — /api 경로에서는 오지 않는다', () => {
    expect(translate(event('message.part.delta', { partID: 'p', field: 'text', delta: 'x' }), CTX)).toEqual(
      [],
    )
  })
})
