import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamStart, textChunk, turnPausedForQuestion, turnStart } from '../../tests/runtime-protocol/turnScript'
import { connectAndHandshake, countOf, type SessionFixture } from '../../tests/runtime-protocol/chatSessionKit'

// 취소와 새 대화.
// 둘 다 없으면 잘못 시작한 응답을 멈출 방법도, 새로 시작할 방법도 없다.

let fixture: SessionFixture | null = null

afterEach(async () => {
  await fixture?.dispose()
  fixture = null
})

/** 턴만 열고 끝내지 않는 서버 — 취소 대상이 있는 상태를 만든다 */
function openEndedTurn() {
  return {
    onChatRequest: (context: { reqId: string; streamId: string; chatId: string }) => {
      const options = { ...context, turnId: 'turn-1' }
      return [streamStart(options), turnStart(options), textChunk(options, '작업 중…')]
    },
  }
}

describe('취소', () => {
  it('streamId 를 봉투에 실어 보낸다 — runtime 은 env.streamId 를 읽는다', async () => {
    fixture = await connectAndHandshake(openEndedTurn())

    fixture.chat.send('오래 걸리는 일')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_started')).toBe(1))

    expect(fixture.chat.cancel()).toBe(true)

    await vi.waitFor(() => {
      const sent = fixture!.server.received.find((f) => f.action === 'stream_cancel')
      expect(sent).toBeTruthy()
      // data 가 아니라 봉투에 있어야 한다
      expect(sent!.raw['streamId']).toBeTruthy()
    })
  })

  it('진행 중인 턴이 없으면 보내지 않는다', async () => {
    fixture = await connectAndHandshake({ onChatRequest: () => [] })

    expect(fixture.chat.cancel()).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fixture.server.received.filter((f) => f.action === 'stream_cancel')).toHaveLength(0)
  })

  it('중단한 턴은 terminal=false stream_end 로도 닫힌다 — HIL 흔적이 남은 취소', async () => {
    // runtime 은 취소된 스트림도 pending interrupt 가 있으면 terminal=false 로 끝낸다
    // (stream_lifecycle.py:112). 재개할 스트림이 없으므로 기다리면 영영 열린 채가 된다.
    fixture = await connectAndHandshake(openEndedTurn())

    fixture.chat.send('오래 걸리는 일')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_started')).toBe(1))

    fixture.chat.cancel()
    fixture.server.push([
      { kind: 'chat', action: 'stream_end', data: { terminal: false } },
    ])

    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))
    expect(fixture.chat.isTurnOpen).toBe(false)
  })

  it('중단 후 아무 응답이 없으면 시간 초과로 턴을 닫는다', async () => {
    // streamId 불일치·HIL 대기 등으로 runtime 이 취소를 못 받으면 stream_end 가 다시 안 온다
    fixture = await connectAndHandshake(openEndedTurn())

    fixture.chat.send('오래 걸리는 일')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_started')).toBe(1))

    vi.useFakeTimers()
    try {
      fixture.chat.cancel()
      await vi.advanceTimersByTimeAsync(5_000)
    } finally {
      vi.useRealTimers()
    }

    expect(countOf(fixture.events, 'turn_ended')).toBe(1)
    expect(fixture.chat.isTurnOpen).toBe(false)
  })

  it('같은 턴을 두 번 끊지 않는다 — 연타·Esc 반복으로 interrupt 가 겹쳐 나갔다', async () => {
    // 화면이 응답하기 전에 또 누르는 것이 이 버그의 실제 사용 방식이었다
    // ("누른 티가 안 나서 또 누르게 된다"). 버튼 disable 은 버튼만 막으므로 여기서도 막는다.
    fixture = await connectAndHandshake(openEndedTurn())

    fixture.chat.send('오래 걸리는 일')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_started')).toBe(1))

    expect(fixture.chat.cancel()).toBe(true)
    expect(fixture.chat.cancel()).toBe(false)
    expect(fixture.chat.cancel()).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fixture.server.received.filter((f) => f.action === 'stream_cancel')).toHaveLength(1)
  })

  it('취소 후 다음 대화를 보낼 수 있다', async () => {
    fixture = await connectAndHandshake(openEndedTurn())

    fixture.chat.send('첫 질문')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_started')).toBe(1))
    fixture.chat.cancel()

    // runtime 은 취소해도 stream_end 를 보내 턴을 닫아준다
    fixture.server.push([
      { kind: 'chat', action: 'stream_end', data: { terminal: true, failed: false } },
    ])
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    fixture.chat.send('둘째 질문')
    await vi.waitFor(() => {
      expect(fixture!.server.received.filter((f) => f.action === 'chat_request')).toHaveLength(2)
    })
  })
})

describe('새 대화', () => {
  it('메시지를 비운다', async () => {
    fixture = await connectAndHandshake(openEndedTurn())

    fixture.chat.send('질문')
    await vi.waitFor(() => expect(fixture!.chat.snapshot().messages.length).toBeGreaterThan(0))

    fixture.chat.reset()
    expect(fixture.chat.snapshot().messages).toEqual([])
    expect(fixture.chat.snapshot().turnMetas).toEqual([])
  })

  it('열려 있던 턴 상태도 푼다 — 새 대화가 잠긴 채 시작하면 안 된다', async () => {
    fixture = await connectAndHandshake(openEndedTurn())

    fixture.chat.send('질문')
    await vi.waitFor(() => expect(fixture!.chat.isTurnOpen).toBe(true))

    fixture.chat.reset()
    expect(fixture.chat.isTurnOpen).toBe(false)
  })

  it('chatId 를 버려 다음 요청이 새 대화로 시작한다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        const options = { ...context, turnId: 'turn-1' }
        return [streamStart(options), turnStart(options), textChunk(options, '응답')]
      },
    })

    fixture.chat.send('첫 질문')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_started')).toBe(1))

    fixture.chat.reset()
    fixture.chat.send('새 대화 첫 질문')

    await vi.waitFor(() => {
      const requests = fixture!.server.received.filter((f) => f.action === 'chat_request')
      expect(requests).toHaveLength(2)
      // 초기화 후 요청에는 chatId 가 없어야 한다
      expect(requests[1]!.raw['chatId']).toBeUndefined()
    })
  })

  it('턴 진행 중 초기화하면 turn_ended 를 발행한다 — renderer HIL 상태가 정리되도록', async () => {
    // turn_ended 없이 조용히 초기화하면 renderer 의 승인·질문·계획·스트리밍 상태가
    // 잔존해 새 대화에 스테일 카드가 남는다 (정리는 sessionSlice 의 turn_ended 에서만).
    fixture = await connectAndHandshake(openEndedTurn())

    fixture.chat.send('질문')
    await vi.waitFor(() => expect(fixture!.chat.isTurnOpen).toBe(true))

    fixture.chat.reset()
    expect(countOf(fixture.events, 'turn_ended')).toBe(1)
    expect(fixture.chat.isTurnOpen).toBe(false)
  })

  it('질문 카드가 뜬 채 초기화해도 turn_ended 를 발행한다 — HIL 일시정지 턴', async () => {
    // 질문 대기는 terminal=false stream_end 로 턴이 열린 채 멈춘 상태다.
    // 이때 초기화하면 turn_ended 가 renderer 까지 흘러 질문 카드가 내려가야 한다.
    fixture = await connectAndHandshake({
      onChatRequest: (context) =>
        turnPausedForQuestion({ ...context, turnId: 'turn-1' }, 'q-1', '진행할까요?'),
    })

    fixture.chat.send('질문')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'question_requested')).toBe(1))
    expect(fixture.chat.isTurnOpen).toBe(true)

    fixture.chat.reset()
    expect(countOf(fixture.events, 'turn_ended')).toBe(1)
    expect(fixture.chat.isTurnOpen).toBe(false)
  })

  it('초기화의 취소 타임아웃이 남지 않는다 — 5초 뒤 두 번째 turn_ended 금지', async () => {
    // reset 의 cancel() 이 건 강제 종단 타이머는 endTurn 이 함께 풀어야 한다.
    // 남으면 새 대화 도중 5초 뒤 엉뚱한 turn_ended 가 발행된다.
    fixture = await connectAndHandshake(openEndedTurn())

    fixture.chat.send('질문')
    await vi.waitFor(() => expect(fixture!.chat.isTurnOpen).toBe(true))

    vi.useFakeTimers()
    try {
      fixture.chat.reset()
      await vi.advanceTimersByTimeAsync(5_000)
    } finally {
      vi.useRealTimers()
    }
    expect(countOf(fixture.events, 'turn_ended')).toBe(1)
  })

  it('진행 중인 스트림을 먼저 취소한다 — vscode createNewChat 과 동일', async () => {
    // 취소하지 않으면 runtime 은 계속 스트리밍하는데 화면은 비어 있어
    // 새 대화에 옛 응답 조각이 섞여 들어온다
    fixture = await connectAndHandshake(openEndedTurn())

    fixture.chat.send('질문')
    await vi.waitFor(() => expect(fixture!.chat.isTurnOpen).toBe(true))

    fixture.chat.reset()

    await vi.waitFor(() => {
      expect(fixture!.server.received.filter((f) => f.action === 'stream_cancel')).toHaveLength(1)
    })
  })

  it('진행 중이 아니면 취소를 보내지 않는다', async () => {
    fixture = await connectAndHandshake({ onChatRequest: () => [] })

    fixture.chat.reset()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(fixture.server.received.filter((f) => f.action === 'stream_cancel')).toHaveLength(0)
  })

  it('스냅샷 구독자에게 빈 상태를 알린다', async () => {
    fixture = await connectAndHandshake(openEndedTurn())
    const snapshots: number[] = []
    fixture.chat.onSnapshot((snapshot) => snapshots.push(snapshot.messages.length))

    fixture.chat.send('질문')
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(0))

    fixture.chat.reset()
    expect(snapshots[snapshots.length - 1]).toBe(0)
  })
})
