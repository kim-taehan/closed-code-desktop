import { afterEach, describe, expect, it, vi } from 'vitest'
import { Action, Kind } from '../../shared/protocol/kinds'
import { streamStart, textChunk, turnStart } from '../../tests/runtime-protocol/turnScript'
import { connectAndHandshake, countOf, type SessionFixture } from '../../tests/runtime-protocol/chatSessionKit'

// ══════════════════════════════════════════════════════════════
//  턴 종료 경로 (desktop2 사후 분석 대응)
//
//  선행 시도가 멀티턴에서 죽은 이유는 턴 종료 신호가 **오직 하나**뿐이라,
//  그 신호를 잃으면 전송이 영구히 잠긴 것이었다.
//  여기서는 어떤 경로로 끝나든 턴이 반드시 닫히는지를 확인한다.
//  docs/reference/desktop2-postmortem.md 참조.
// ══════════════════════════════════════════════════════════════

let fixture: SessionFixture | null = null

afterEach(async () => {
  await fixture?.dispose()
  fixture = null
})

describe('stream_end 없이 error 만 오는 턴', () => {
  it('error 프레임만으로도 턴이 닫힌다', async () => {
    // 실제 기록: 에러로 끝난 턴은 stream_end 가 아예 오지 않는 경우가 있다.
    // 이 경로에서 턴이 안 닫히면 다음 전송이 영영 막힌다.
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        const options = { ...context, turnId: 'turn-1' }
        return [
          streamStart(options),
          turnStart(options),
          {
            kind: Kind.CHAT,
            action: Action.ERROR,
            replyTo: context.reqId,
            streamId: context.streamId,
            data: { code: 'OPENAI_BADREQUEST', message: '모델 오류' },
          },
          // stream_end 없음 — 여기서 끝이다
        ]
      },
    })

    fixture.chat.send('hello')

    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))
    const ended = fixture.events.find((event) => event.type === 'turn_ended') as {
      failed: boolean
      errorCode?: string
    }
    expect(ended.failed).toBe(true)
    expect(ended.errorCode).toBe('OPENAI_BADREQUEST')
    expect(fixture.chat.isTurnOpen).toBe(false)
  })

  it('error 로 닫힌 뒤에도 다음 턴을 보낼 수 있다', async () => {
    let round = 0
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        round += 1
        const options = { ...context, turnId: `turn-${round}` }
        if (round === 1) {
          return [
            streamStart(options),
            turnStart(options),
            {
              kind: Kind.CHAT,
              action: Action.ERROR,
              replyTo: context.reqId,
              streamId: context.streamId,
              data: { code: 'STREAM_ERROR', message: '끊김' },
            },
          ]
        }
        return [
          streamStart(options),
          turnStart(options),
          textChunk(options, '두 번째는 정상'),
          {
            kind: Kind.CHAT,
            action: Action.STREAM_END,
            replyTo: context.reqId,
            streamId: context.streamId,
            data: { terminal: true, failed: false },
          },
        ]
      },
    })

    fixture.chat.send('첫 질문')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    fixture.chat.send('둘째 질문')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(2))

    expect(countOf(fixture.events, 'turn_started')).toBe(2)
  })
})

describe('턴 종료는 정확히 한 번만', () => {
  it('error 와 stream_end 가 둘 다 와도 turn_ended 는 하나다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        const options = { ...context, turnId: 'turn-1' }
        return [
          streamStart(options),
          turnStart(options),
          {
            kind: Kind.CHAT,
            action: Action.ERROR,
            replyTo: context.reqId,
            streamId: context.streamId,
            data: { code: 'SERVICE_ERROR', message: '실패' },
          },
          {
            kind: Kind.CHAT,
            action: Action.STREAM_END,
            replyTo: context.reqId,
            streamId: context.streamId,
            data: { terminal: true, failed: true, errorCode: 'SERVICE_ERROR' },
          },
        ]
      },
    })

    fixture.chat.send('hello')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(countOf(fixture.events, 'turn_ended')).toBe(1)
  })

  it('턴이 열려 있지 않으면 종료 신호가 와도 아무 일도 없다', async () => {
    fixture = await connectAndHandshake({ onChatRequest: () => [] })

    // 턴을 연 적이 없다
    fixture.connection.send(
      JSON.stringify({
        kind: Kind.CHAT,
        action: Action.STREAM_END,
        data: { terminal: true, failed: false },
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(countOf(fixture.events, 'turn_ended')).toBe(0)
  })
})

describe('턴 도중 소켓이 끊기는 경우', () => {
  it('연결이 끊기면 열려 있던 턴이 닫힌다', async () => {
    // 선행 시도는 여기서 큐를 안 닫아 영구 대기에 빠졌다.
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        const options = { ...context, turnId: 'turn-1' }
        // 턴만 열고 끝내지 않는다
        return [streamStart(options), turnStart(options), textChunk(options, '작업 중…')]
      },
    })

    fixture.chat.send('오래 걸리는 일')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_started')).toBe(1))
    expect(fixture.chat.isTurnOpen).toBe(true)

    // 상대가 사라진다 (예전에는 소켓 서버를 껐다 — 지금은 연결이 끊긴다)
    fixture.connection.drop()

    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))
    const ended = fixture.events.find((event) => event.type === 'turn_ended') as {
      failed: boolean
      errorCode?: string
    }
    expect(ended.failed).toBe(true)
    expect(ended.errorCode).toBe('CONNECTION_LOST')
    expect(fixture.chat.isTurnOpen).toBe(false)
  })

  it('턴이 없을 때 끊기면 turn_ended 를 만들지 않는다', async () => {
    fixture = await connectAndHandshake({ onChatRequest: () => [] })

    fixture.connection.drop()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(countOf(fixture.events, 'turn_ended')).toBe(0)
  })
})
