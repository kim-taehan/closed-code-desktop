import { afterEach, describe, expect, it, vi } from 'vitest'
import { Action, AuthState, Kind } from '../../shared/protocol/kinds'
import { Handshake } from './handshake'
import { textOnlyTurn } from '../../tests/fake-runtime/turnScript'
import { connectAndHandshake, countOf, type SessionFixture } from '../../tests/fake-runtime/chatSessionKit'
import { MemoryConnection } from '../../tests/fake-runtime/MemoryConnection'

// ══════════════════════════════════════════════════════════════
//  에러 처리 전수 (설계 §8) — C2
//  표의 모든 행에 테스트를 하나씩 둔다.
// ══════════════════════════════════════════════════════════════

let fixture: SessionFixture | null = null

afterEach(async () => {
  await fixture?.dispose()
  fixture = null
})

// **「§8 — 연결 실패와 재연결」 두 건은 2026-08-26 에 삭제됐다.**
// 연결 거부와 지수 백오프를 재던 것으로 `WsConnection` 고유의 성질이었는데, 앱이
// opencode(HTTP+SSE)로 옮겨가며 그 클래스에 프로덕션 호출자가 없어져 함께 없어졌다.
// **같은 자리를 지금 지키는 것은 `opencode/sse.ts` 의 재연결 백오프**이고 그쪽 시험이 있다.
// 아래 §8 나머지는 전송이 아니라 프레임 계약을 재므로 인메모리 대역으로 옮겨 살아 있다.

describe('§8 — 인증 실패', () => {
  it('auth_state 가 valid 가 아니면 자동 재시도 없이 실패한다', async () => {
    const connection = new MemoryConnection({ authState: AuthState.INVALID })
    const handshake = new Handshake(connection, { workspacePath: '/tmp' })

    const done = handshake.run()
    await connection.connect()

    await expect(done).rejects.toThrow(/authenticating/)
    expect(handshake.state.failure?.stage).toBe('authenticating')

    handshake.dispose()
    connection.dispose()
  })
})

describe('§8 — 단계별 타임아웃', () => {
  it('어느 단계에서 멈췄는지 메시지에 담는다', async () => {
    const stalled = {
      isOpen: true,
      send: () => true,
      onOpen: () => () => {},
      onMessage: () => () => {},
      onClose: () => () => {},
      onError: () => () => {},
      close: () => {},
    }
    const handshake = new Handshake(stalled, {
      workspacePath: '/tmp',
      timeouts: { connected: 30 },
    })

    await expect(handshake.run()).rejects.toThrow(/awaiting_connected/)
    expect(handshake.state.failure?.reason).toContain('system/connected')
    handshake.dispose()
  })
})

describe('§8 — error 프레임', () => {
  it('code 와 message 를 이벤트로 올린다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => [
        {
          kind: Kind.CHAT,
          action: Action.ERROR,
          replyTo: context.reqId,
          streamId: context.streamId,
          data: { code: 'SERVICE_ERROR', message: '서비스 오류' },
        },
      ],
    })

    fixture.chat.send('hello')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'error')).toBe(1))

    const error = fixture.events.find((event) => event.type === 'error') as {
      message: string
      code?: string
    }
    expect(error.message).toBe('서비스 오류')
    expect(error.code).toBe('SERVICE_ERROR')

    // 이벤트만으로는 화면이 무반응이다 — 대화에 에러 메시지가 남아야 한다
    const messages = fixture.chat.snapshot().messages
    expect(messages.some((m) => m.kind === 'error' && m.content.includes('서비스 오류'))).toBe(true)
  })
})

describe('§8 — stream_end.failed', () => {
  it('실패로 종료하고 errorCode 를 담는다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        const frames = textOnlyTurn({ ...context, turnId: 'turn-1' }, '부분 응답')
        return [
          frames[0]!,
          frames[1]!,
          frames[2]!,
          {
            kind: Kind.CHAT,
            action: Action.STREAM_END,
            replyTo: context.reqId,
            streamId: context.streamId,
            data: { terminal: true, failed: true, errorCode: 'MODEL_ERROR' },
          },
        ]
      },
    })

    fixture.chat.send('hello')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    expect(fixture.events.find((event) => event.type === 'turn_ended')).toMatchObject({
      failed: true,
      errorCode: 'MODEL_ERROR',
    })

    // 실패로 끝났는데 보여줄 에러가 없으면 무반응이다 — 일반 에러라도 남는다
    const messages = fixture.chat.snapshot().messages
    expect(messages.some((m) => m.kind === 'error')).toBe(true)
  })

  // error 프레임 없이 stream_end 만으로 실패하는 경로는 turnGate 의 하드코딩 폴백을 탄다
  // (turnGate.ts:104). 그 폴백도 카탈로그를 거쳐야 코드값이 화면에 안 남는다 — 순서 의존이라
  // 정적 검증으로는 안 잡힌다 (QA 재생 #4).
  it('error 프레임이 없어도 errorCode 만으로 카탈로그 문구를 낸다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        const frames = textOnlyTurn({ ...context, turnId: 'turn-1' }, '부분 응답')
        return [
          frames[0]!,
          frames[1]!,
          frames[2]!,
          {
            kind: Kind.CHAT,
            action: Action.STREAM_END,
            replyTo: context.reqId,
            streamId: context.streamId,
            data: { terminal: true, failed: true, errorCode: 'AUTH_KEY_EXPIRED' },
          },
        ]
      },
    })

    fixture.chat.send('hello')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    const error = fixture.chat.snapshot().messages.find((m) => m.kind === 'error')
    expect(error?.content).toContain('라이선스 만료')
    // 폴백 문구도 코드값도 사용자 앞에 남지 않는다
    expect(error?.content).not.toContain('요청을 처리하지 못했습니다')
    expect(error?.content).not.toContain('AUTH_KEY_EXPIRED')
  })
})

describe('§8 — 표에 없는 messageType', () => {
  it('예외를 던지지 않고 나머지 청크는 정상 처리된다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        const frames = textOnlyTurn({ ...context, turnId: 'turn-1' }, '정상 응답')
        const unknown = { ...frames[0]!, action: 'stream_chunk', data: { messageType: 'unknown_x' } }
        return [frames[0]!, frames[1]!, unknown, frames[2]!, frames[3]!, frames[4]!]
      },
    })

    fixture.chat.send('hello')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    expect(fixture.events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text))
      .toEqual(['정상 응답'])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('깨진 JSON 프레임에도 죽지 않는다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => textOnlyTurn({ ...context, turnId: 'turn-1' }, '응답'),
    })

    // 파싱 불가 프레임을 직접 밀어넣는다
    fixture.server.push([{ kind: 'chat', action: 'stream_chunk', data: null }])
    fixture.chat.send('hello')

    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))
    expect(countOf(fixture.events, 'text')).toBe(1)
  })
})

describe('§8 — tool_result 매칭 실패', () => {
  it('짝 없는 결과는 폐기하고 유령 메시지를 만들지 않는다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        const frames = textOnlyTurn({ ...context, turnId: 'turn-1' }, '응답')
        const orphan = {
          ...frames[0]!,
          action: 'stream_chunk',
          data: { messageType: 'tool_result', toolCallId: '없는id', result: 'x' },
        }
        return [frames[0]!, frames[1]!, orphan, frames[2]!, frames[3]!, frames[4]!]
      },
    })

    fixture.chat.send('hello')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    // 도구 메시지가 하나도 만들어지지 않아야 한다
    const snapshot = fixture.chat.snapshot()
    expect(snapshot.messages.filter((m) => m.kind === 'tool_call')).toHaveLength(0)
  })
})
