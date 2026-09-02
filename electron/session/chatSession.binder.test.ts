import { afterEach, describe, expect, it, vi } from 'vitest'
import { textOnlyTurn, turnPausedForApproval } from '../../tests/runtime-protocol/turnScript'
import { connectAndHandshake, countOf, type SessionFixture } from '../../tests/runtime-protocol/chatSessionKit'
import type { TurnBinder } from './turnBinder'

// 확장이 채팅으로 물은 턴을 되찾는 배선 (설계 2026-08-13).
//
// 확장 질의는 **사용자 입력과 같은 통로**로 나가므로, 세션 입장에서 둘은 구분이 없다.
// 구분은 `extensionRequestId` 하나뿐이고, 그 표시가 제때 장부로 넘어가는지가 여기서 갈린다.

function spyBinder() {
  const calls: string[] = []
  const binder: TurnBinder = {
    markPending: (id) => calls.push(`pending:${id}`),
    onStreamStart: (streamId) => calls.push(`start:${streamId ? 'yes' : 'no'}`),
    onStreamEnd: (_streamId, text) => calls.push(`end:${text}`),
    onCancelled: () => calls.push('cancelled'),
    rejectPending: (reason) => calls.push(`reject:${reason}`),
  }
  return { binder, calls }
}

let fixture: SessionFixture | null = null

afterEach(async () => {
  await fixture?.dispose()
  fixture = null
})

describe('확장 질의 배선', () => {
  it('확장이 보낸 턴은 표시 → 시작 → 답 순서로 장부에 넘어간다', async () => {
    const { binder, calls } = spyBinder()
    fixture = await connectAndHandshake(
      { onChatRequest: (context) => textOnlyTurn({ ...context, turnId: 't1' }, '확장에게 줄 답') },
      { binder },
    )

    fixture.chat.send('분석해줘', { extensionRequestId: 'req-1' })
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    expect(calls[0]).toBe('pending:req-1')
    expect(calls).toContain('start:yes')
    expect(calls.at(-1)).toBe('end:확장에게 줄 답')
  })

  it('사용자가 보낸 턴은 표시하지 않는다 — 남의 턴으로 확장의 약속이 풀리면 안 된다', async () => {
    const { binder, calls } = spyBinder()
    fixture = await connectAndHandshake(
      { onChatRequest: (context) => textOnlyTurn({ ...context, turnId: 't1' }, '사용자에게 줄 답') },
      { binder },
    )

    fixture.chat.send('그냥 질문')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    // 턴 신호 자체는 넘어가지만(장부가 대기 중인 것이 없으면 무시한다) **표시는 없다**
    expect(calls.some((call) => call.startsWith('pending:'))).toBe(false)
  })

  it('사용자가 끊으면 취소로 넘어간다 — 오류가 아니다', async () => {
    const { binder, calls } = spyBinder()
    fixture = await connectAndHandshake(
      // 승인 대기에서 멈춰 세운다 — 턴이 열려 있어야 cancel 이 성립한다
      { onChatRequest: (context) => turnPausedForApproval({ ...context, turnId: 't1' }, 'ap-1') },
      { binder },
    )

    fixture.chat.send('오래 걸리는 것', { extensionRequestId: 'req-2' })
    await vi.waitFor(() => expect(fixture!.chat.isTurnOpen).toBe(true))
    fixture.chat.cancel()

    expect(calls).toContain('cancelled')
  })
})
