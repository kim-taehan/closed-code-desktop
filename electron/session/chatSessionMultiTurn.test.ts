import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  failedTurn,
  textOnlyTurn,
  turnPausedForApproval,
  turnResumedAfterApproval,
} from '../../tests/fake-runtime/turnScript'
import { connectAndHandshake, countOf, textsOf, type SessionFixture } from '../../tests/fake-runtime/chatSessionKit'
import type { ChatSnapshot } from './chatSession'

// 멀티턴 회귀 방지.
// 두 번째 이후 전송이 무시되거나 응답이 안 오는 것이 선행 시도에서 겪은 증상이다.
// 전송 잠금이 안 풀리거나 턴이 합쳐지면 여기서 잡힌다.

let fixture: SessionFixture | null = null

afterEach(async () => {
  await fixture?.dispose()
  fixture = null
})

describe('이력 재로드 중복 방지 (loadHistory 는 재생 전 reset)', () => {
  it('reset 하면 메시지가 비워져, 다시 받아도 이전 내용에 누적되지 않는다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => textOnlyTurn({ ...context, turnId: `t-${context.streamId}` }, '응답'),
    })
    const snaps: ChatSnapshot[] = []
    fixture.chat.onSnapshot((s) => snaps.push(s))

    fixture.chat.send('질문')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))
    const count = snaps.at(-1)!.messages.length
    expect(count).toBeGreaterThan(0)

    // loadHistory 의 핵심: 재생 전에 화면을 비운다
    fixture.chat.reset()
    expect(snaps.at(-1)!.messages).toHaveLength(0)

    // 같은 응답을 다시 받아도 2배가 아니라 같은 수 (중복 append 안 됨)
    fixture.chat.send('질문2')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(2))
    expect(snaps.at(-1)!.messages.length).toBe(count)
  })
})

describe('연속 턴', () => {
  it('세 턴이 각각 독립적으로 시작하고 끝난다', async () => {
    let round = 0
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        round += 1
        return textOnlyTurn({ ...context, turnId: `turn-${round}` }, `${round}번째 응답`)
      },
    })

    for (let attempt = 1; attempt <= 3; attempt++) {
      fixture.chat.send(`${attempt}번째 질문`)
      await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(attempt))
    }

    expect(countOf(fixture.events, 'turn_started')).toBe(3)
    const endedTurnIds = fixture.events
      .filter((event) => event.type === 'turn_ended')
      .map((event) => (event as { turnId: string }).turnId)
    // 턴 id 가 서로 달라야 한다 — 합쳐지면 화면에 하나로 보인다
    expect(new Set(endedTurnIds).size).toBe(3)
    expect(textsOf(fixture.events).join('|')).toBe('1번째 응답|2번째 응답|3번째 응답')
  })

  it('첫 턴이 실패해도 다음 턴을 보낼 수 있다', async () => {
    // 실패 후 전송 잠금이 안 풀리면 여기서 잡힌다
    let round = 0
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        round += 1
        return round === 1
          ? failedTurn({ ...context, turnId: 'turn-1' }, 'SERVICE_ERROR', '일시 오류')
          : textOnlyTurn({ ...context, turnId: 'turn-2' }, '이번엔 성공')
      },
    })

    fixture.chat.send('첫 질문')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    fixture.chat.send('둘째 질문')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(2))

    const ended = fixture.events.filter((event) => event.type === 'turn_ended') as { failed: boolean }[]
    expect(ended[0]!.failed).toBe(true)
    expect(ended[1]!.failed).toBe(false)
    expect(textsOf(fixture.events).join('')).toBe('이번엔 성공')
  })

  it('승인으로 멈춘 턴을 끝낸 뒤 다음 턴이 정상 동작한다', async () => {
    let round = 0
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        round += 1
        return round === 1
          ? turnPausedForApproval({ ...context, turnId: 'turn-1' }, 'req-1')
          : textOnlyTurn({ ...context, turnId: 'turn-2' }, '두 번째 턴 정상')
      },
      onApprovalResponse: (context) =>
        turnResumedAfterApproval(
          { reqId: context.reqId, streamId: 'stream-1', chatId: context.chatId, turnId: 'turn-1' },
          '첫 턴 완료',
        ),
    })

    fixture.chat.send('파일 고쳐줘')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'approval_requested')).toBe(1))
    fixture.chat.respondApproval('req-1', true)
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    fixture.chat.send('다음 질문')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(2))

    expect(countOf(fixture.events, 'turn_started')).toBe(2)
    expect(textsOf(fixture.events).join('|')).toBe('첫 턴 완료|두 번째 턴 정상')
  })

  it('서버가 발급한 chatId 를 이후 요청에 계속 싣는다', async () => {
    // chatId 를 안 실으면 매 턴이 새 세션이 되어 문맥이 끊긴다
    fixture = await connectAndHandshake({
      onChatRequest: (context) => textOnlyTurn({ ...context, turnId: `turn-${context.streamId}` }, '응답'),
    })

    fixture.chat.send('첫 질문')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))
    fixture.chat.send('둘째 질문')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(2))

    const requests = fixture.server.received.filter((frame) => frame.action === 'chat_request')
    expect(requests).toHaveLength(2)
    // 첫 요청엔 chatId 가 없고, 두 번째부터는 서버가 준 chatId 가 실린다
    expect(requests[1]!.raw['chatId']).toBe('fake-chat')
  })
})
