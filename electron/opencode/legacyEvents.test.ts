import { describe, expect, it } from 'vitest'
import { normalizeLegacyEvent } from './legacyEvents'
import { translate, type TranslateContext } from './translate'
import type { OpencodeEvent } from './events'

// 입력은 **실제로 캡처한 페이로드**다 (opencode 1.18.18, `GET /event`, 2026-08-14).
// 목 LLM 으로 도구 호출까지 재현해 받은 것을 그대로 옮겼다 — 손으로 지어낸 모양으로
// 재면 어댑터가 실물과 어긋나도 초록으로 남는다.
//
// 이 파일은 **되옮기기(이름·필드)** 만 겨눈다. davis 청크로 가는 매핑은 `translate.test.ts` 다.

const SES = 'ses_000c52e72ffe2nOOurUu42RjUW'
const MSG = 'msg_fff3ad1f9001dnDsI8pMYZ6t3u'
const CTX: TranslateContext = { streamId: 'st1' }

function event(type: string, properties: Record<string, unknown>): OpencodeEvent {
  return { id: 'evt_1', type, properties: { sessionID: SES, ...properties } }
}

function partUpdated(part: Record<string, unknown>): OpencodeEvent {
  return event('message.part.updated', { part, time: 1786693472857 })
}

function dataOf(frame: unknown): Record<string, unknown> {
  return (frame as { data: Record<string, unknown> }).data
}

describe('되옮기기 — 텍스트·추론', () => {
  it('message.part.delta(field=text) 는 텍스트 델타가 된다', () => {
    const normalized = normalizeLegacyEvent(
      event('message.part.delta', { messageID: MSG, partID: 'prt_1', field: 'text', delta: '도구를 ' }),
    )
    expect(normalized?.type).toBe('session.next.text.delta')
    expect(normalized?.properties).toMatchObject({
      sessionID: SES,
      assistantMessageID: MSG,
      textID: 'prt_1',
      delta: '도구를 ',
    })
  })

  // 레거시는 이벤트 이름이 아니라 **`field`** 로 둘을 가른다. 이걸 놓치면 추론이
  // 본문으로 섞여 나온다 (davis 쪽은 버블이 아예 다르다).
  it('field=reasoning 은 추론 델타가 된다 — 이름이 아니라 field 로 갈린다', () => {
    const normalized = normalizeLegacyEvent(
      event('message.part.delta', { messageID: MSG, partID: 'prt_r', field: 'reasoning', delta: '생각' }),
    )
    expect(normalized?.type).toBe('session.next.reasoning.delta')
  })
})

describe('되옮기기 — step', () => {
  it('step-start 는 턴 시작이 된다', () => {
    const normalized = normalizeLegacyEvent(
      partUpdated({ id: 'prt_s', messageID: MSG, sessionID: SES, type: 'step-start', snapshot: '7a2af71' }),
    )
    expect(normalized?.type).toBe('session.next.step.started')
    expect(normalized?.properties).toMatchObject({ assistantMessageID: MSG })
  })

  // `reason` 이 신규의 `finish` 자리다. 값이 같은 문자열인 것을 실측으로 확인했고,
  // 그래서 `translate.ts` 의 "tool-calls 면 턴을 안 닫는다" 판단이 그대로 산다.
  it('step-finish 의 reason 은 finish 가 된다', () => {
    const normalized = normalizeLegacyEvent(
      partUpdated({
        id: 'prt_f',
        messageID: MSG,
        type: 'step-finish',
        reason: 'tool-calls',
        tokens: { input: 1, output: 1 },
      }),
    )
    expect(normalized?.type).toBe('session.next.step.ended')
    expect(normalized?.properties).toMatchObject({ finish: 'tool-calls', tokens: { input: 1, output: 1 } })
  })

  it('도구를 부르려고 끊긴 step 은 턴을 닫지 않는다', () => {
    const frames = translate(
      partUpdated({ id: 'prt_f', messageID: MSG, type: 'step-finish', reason: 'tool-calls' }),
      CTX,
    )
    expect(frames).toEqual([])
  })
})

describe('되옮기기 — 도구', () => {
  const base = { id: 'prt_tool', messageID: MSG, sessionID: SES, type: 'tool', tool: 'probe_probe_tool', callID: 'call_probe_1' }

  it('pending 에서 이미 이름을 알고 도구 카드를 낸다', () => {
    const frames = translate(partUpdated({ ...base, state: { status: 'pending', input: {}, raw: '' } }), CTX)
    expect(frames).toHaveLength(1)
    expect(dataOf(frames[0])).toMatchObject({
      messageType: 'tool_call',
      toolName: 'probe_probe_tool',
      toolCallId: 'call_probe_1',
    })
  })

  // `running` 은 인자가 확정됐다는 뜻뿐이다. 옮기면 같은 callID 의 도구 카드가 두 번 뜬다 —
  // 레거시는 **같은 part.id 로 상태만 바꿔 3번 오기** 때문에 여기가 특히 위험하다.
  it('running 은 버린다 — 옮기면 도구 카드가 두 번 뜬다', () => {
    const frames = translate(
      partUpdated({ ...base, state: { status: 'running', input: { q: 'hi' }, time: { start: 1 } } }),
      CTX,
    )
    expect(frames).toEqual([])
  })

  // 레거시 결과는 `state.output` 문자열 하나다 — 신규의 `output`/`structured` 두 갈래가 아니다.
  it('completed 는 state.output 을 결과로 싣는다', () => {
    const frames = translate(
      partUpdated({
        ...base,
        state: { status: 'completed', input: { q: 'hi' }, output: 'probe_tool ran', title: '' },
      }),
      CTX,
    )
    expect(dataOf(frames[0])).toMatchObject({
      messageType: 'tool_result',
      toolCallId: 'call_probe_1',
      success: true,
      result: 'probe_tool ran',
    })
  })

  it('error 는 실패로 옮긴다', () => {
    const frames = translate(
      partUpdated({ ...base, state: { status: 'error', input: {}, error: '터졌다' } }),
      CTX,
    )
    expect(dataOf(frames[0])).toMatchObject({ messageType: 'tool_result', success: false, error: '터졌다' })
  })
})

describe('버리는 것', () => {
  // 글은 `message.part.delta` 로 이미 흘렀고 이건 완성본을 다시 주는 것이다.
  // 옮기면 답이 두 번 찍힌다.
  it('text 파트의 갱신은 버린다 — 델타로 이미 흘렀다', () => {
    const frames = translate(
      partUpdated({ id: 'prt_t', messageID: MSG, type: 'text', text: '완성된 답', time: { start: 1, end: 2 } }),
      CTX,
    )
    expect(frames).toEqual([])
  })

  // 사용자가 방금 보낸 메시지도 같은 모양으로 되돌아온다. 옮기면 제 말이 답으로도 뜬다.
  it('사용자 메시지 에코도 같은 자리에서 버려진다', () => {
    const frames = translate(
      partUpdated({ id: 'prt_u', messageID: 'msg_user', type: 'text', text: '내가 친 말' }),
      CTX,
    )
    expect(frames).toEqual([])
  })
})

describe('승인 요청 — 이름은 같은데 필드가 다르다', () => {
  // 실측 페이로드 그대로. 안 채우면 승인 카드가 "알 수 없는 도구" 로 뜬다.
  it('permission/patterns 를 action/resources 자리에 채운다', () => {
    const frames = translate(
      event('permission.asked', {
        id: 'per_1',
        permission: 'bash',
        patterns: ['echo hi'],
        metadata: { command: 'echo hi' },
        always: ['echo *'],
        tool: { messageID: MSG, callID: 'call_probe_1' },
      }),
      CTX,
    )
    expect(dataOf(frames[0])).toMatchObject({
      messageType: 'tool_approval_request',
      requestId: 'per_1',
      toolName: 'bash',
      args: { resources: ['echo hi'] },
    })
  })

  // 두 세대가 같은 이벤트 이름을 쓰는 자리다. 덮어쓰면 신규 쪽이 조용히 망가진다.
  it('신규 이름이 이미 실려 있으면 건드리지 않는다', () => {
    const normalized = normalizeLegacyEvent(
      event('permission.asked', { id: 'per_2', action: 'read', resources: ['a.ts'] }),
    )
    expect(normalized?.properties).toMatchObject({ action: 'read', resources: ['a.ts'] })
  })
})

describe('질문 — 글이 questions[] 안에 있다', () => {
  // 실측 페이로드 그대로. 평평한 `question` 이 없어서, 안 올려 주면 질문 카드가 빈 채로 뜬다.
  it('questions[0].question 을 평평한 자리로 올린다', () => {
    const frames = translate(
      event('question.asked', {
        id: 'que_1',
        questions: [
          {
            question: '어느 쪽으로 갈까요?',
            header: '방향',
            options: [{ label: '왼쪽' }, { label: '오른쪽' }],
          },
        ],
        tool: { messageID: MSG, callID: 'call_ask_1' },
      }),
      CTX,
    )
    expect(dataOf(frames[0])).toMatchObject({
      messageType: 'user_question',
      questionId: 'que_1',
      question: '어느 쪽으로 갈까요?',
    })
  })

  it('평평한 question 이 이미 있으면 건드리지 않는다', () => {
    const frames = translate(event('question.asked', { id: 'que_2', question: '이미 평평하다' }), CTX)
    expect(dataOf(frames[0])).toMatchObject({ question: '이미 평평하다' })
  })
})

describe('취소', () => {
  /**
   * 레거시에서 사용자 취소는 `session.error` 로 온다 (실측 순서:
   * `session.error{MessageAbortedError}` → `session.status{idle}` → `session.idle`).
   * 그대로 옮기면 스스로 끊은 자리에 빨간 "Aborted" 가 뜬다.
   */
  it('MessageAbortedError 는 오류로 옮기지 않는다', () => {
    const frames = translate(
      event('session.error', { error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } }),
      CTX,
    )
    expect(frames).toEqual([])
  })

  it('뒤따르는 session.idle 이 턴을 닫는다', () => {
    const frames = translate(event('session.idle', {}), CTX)
    expect(frames.some((frame) => (frame as { action?: string }).action === 'stream_end')).toBe(true)
  })

  // 진짜 실패까지 삼키면 안 된다 — 가르는 것은 이름 하나뿐이다.
  it('다른 오류는 그대로 실패로 옮긴다', () => {
    const frames = translate(
      event('session.error', { error: { name: 'ProviderError', data: { message: '터졌다' } } }),
      CTX,
    )
    expect(dataOf(frames[0])).toMatchObject({ messageType: 'error', message: '터졌다' })
  })
})
