import { afterEach, describe, expect, it, vi } from 'vitest'
import { failedTurn, textOnlyTurn, turnPausedForApproval } from '../../tests/runtime-protocol/turnScript'
import { connectAndHandshake, countOf, textsOf, type SessionFixture } from '../../tests/runtime-protocol/chatSessionKit'

// 단일 턴 동작과 승인 응답. 멀티턴은 chatSessionMultiTurn.test.ts 에 있다.

let fixture: SessionFixture | null = null

afterEach(async () => {
  await fixture?.dispose()
  fixture = null
})

describe('기본 턴', () => {
  it('메시지를 보내면 텍스트가 오고 턴이 종료된다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => textOnlyTurn({ ...context, turnId: 'turn-1' }, '안녕하세요'),
    })

    fixture.chat.send('hello')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    expect(fixture.events.map((event) => event.type)).toEqual(['turn_started', 'text', 'turn_ended'])
    expect(textsOf(fixture.events).join('')).toBe('안녕하세요')
    expect(fixture.events.find((event) => event.type === 'turn_ended')).toMatchObject({
      turnId: 'turn-1',
      failed: false,
    })
  })

  it('turn_end 가 terminal:true 로 와도 stream_end 가 실제 turnId 를 담는다', async () => {
    // 회귀 방지: turn_end(terminal:true) 가 활성 턴을 놓은 직후 stream_end 가 오면
    // 활성 턴이 이미 null 이라 turnId 를 잃는다. 실제 runtime 에서만 드러났던 버그다.
    fixture = await connectAndHandshake({
      onChatRequest: (context) => textOnlyTurn({ ...context, turnId: 'turn-real' }, '응답'),
    })

    fixture.chat.send('hello')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    const ended = fixture.events.find((event) => event.type === 'turn_ended') as { turnId: string }
    expect(ended.turnId).toBe('turn-real')
    expect(ended.turnId).not.toBe('turn-unknown')
  })

  it('여러 텍스트 청크가 순서대로 온다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        const frames = textOnlyTurn({ ...context, turnId: 'turn-1' }, 'x')
        const [start, turnStart, , turnEndFrame, end] = frames
        const chunk = (message: string) => ({
          ...start!,
          action: 'stream_chunk',
          data: { messageType: 'text', message },
        })
        return [start!, turnStart!, chunk('첫 '), chunk('둘 '), chunk('셋'), turnEndFrame!, end!]
      },
    })

    fixture.chat.send('hello')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    expect(textsOf(fixture.events).join('')).toBe('첫 둘 셋')
  })

  it('실패한 턴은 failed 로 종료된다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => failedTurn({ ...context, turnId: 'turn-1' }, 'SERVICE_ERROR', '런타임 오류'),
    })

    fixture.chat.send('hello')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    expect(countOf(fixture.events, 'error')).toBe(1)
    expect(fixture.events.find((event) => event.type === 'turn_ended')).toMatchObject({
      failed: true,
      errorCode: 'SERVICE_ERROR',
    })
  })
})

describe('승인 처리', () => {
  it('terminal:false 에서는 턴을 닫지 않는다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => turnPausedForApproval({ ...context, turnId: 'turn-1' }, 'req-1'),
    })

    fixture.chat.send('파일 고쳐줘')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'approval_requested')).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 60))

    // 승인 대기 중이므로 턴이 종료되면 안 된다 (설계 §4.4)
    expect(countOf(fixture.events, 'turn_ended')).toBe(0)
  })

  it('승인 응답이 requestId 와 approved 를 담아 나간다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => turnPausedForApproval({ ...context, turnId: 'turn-1' }, 'req-9'),
    })

    fixture.chat.send('파일 고쳐줘')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'approval_requested')).toBe(1))
    fixture.chat.respondApproval('req-9', false)

    await vi.waitFor(() => {
      const sent = fixture!.server.received.find((frame) => frame.action === 'tool_approval_response')
      expect(sent?.data).toMatchObject({ requestId: 'req-9', approved: false })
    })
  })

  it('autoApprove 면 사용자에게 묻지 않고 바로 승인한다', async () => {
    fixture = await connectAndHandshake(
      { onChatRequest: (context) => turnPausedForApproval({ ...context, turnId: 'turn-1' }, 'req-1') },
      { autoApprove: true },
    )

    fixture.chat.send('hello')
    await vi.waitFor(() => {
      expect(fixture!.server.received.some((frame) => frame.action === 'tool_approval_response')).toBe(true)
    })
    expect(countOf(fixture.events, 'approval_requested')).toBe(0)
  })
})

describe('미지 타입 처리', () => {
  it('표에 없는 messageType 에서 예외를 던지지 않고 로그만 남긴다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        const frames = textOnlyTurn({ ...context, turnId: 'turn-1' }, '정상')
        const unknown = { ...frames[0]!, action: 'stream_chunk', data: { messageType: 'aliens_landed' } }
        return [frames[0]!, frames[1]!, unknown, frames[2]!, frames[3]!, frames[4]!]
      },
    })

    fixture.chat.send('hello')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    // 미지 타입이 있어도 정상 텍스트와 턴 종료는 그대로다
    expect(textsOf(fixture.events).join('')).toBe('정상')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('매핑표'), expect.anything())
    spy.mockRestore()
  })
})
