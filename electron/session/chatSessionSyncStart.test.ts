import { describe, expect, it } from 'vitest'
import { ChatSession } from './chatSession'
import type { Transport } from '../ws/transport'
import type { TurnBinder } from './turnBinder'

// **확장 요청의 등록은 `transport.send()` 보다 먼저여야 한다.**
//
// opencode 어댑터는 `send()` 안에서 곧바로 턴을 연다 (`electron/opencode/transport.ts`:
// `send → dispatch → onChatRequest` 가 첫 `await` 전에 `STREAM_START` 를 emit 한다).
// 그래서 등록이 뒤에 오면 턴이 이미 열린 뒤라 **장부가 아무것도 안 묶고**, 답이 와도
// 확장의 promise 가 영영 안 풀린다.
//
// 실물에서만 드러났다 (2026-08-14): 답은 대화창에 왔는데 사이드바가 「찾는 중」에 멈췄다.
// 다른 시험들이 쓰는 가짜 런타임은 턴을 **비동기로** 열어서 이 순서를 못 본다 —
// 그래서 여기서는 런타임을 흉내 내지 않고 **순서 자체**를 못 박는다.

/** 아무것도 안 하는 최소 transport. `send` 가 불린 시점만 기록한다. */
function recordingTransport(calls: string[]): Transport {
  return {
    connect: () => Promise.resolve(),
    close: () => {},
    send: () => {
      calls.push('send')
      return true
    },
    onMessage: () => () => {},
    onClose: () => () => {},
    onError: () => () => {},
  } as unknown as Transport
}

function spyBinder(calls: string[]): TurnBinder {
  return {
    markPending: (id) => calls.push(`pending:${id}`),
    onStreamStart: () => calls.push('start'),
    onStreamEnd: () => calls.push('end'),
    onCancelled: () => calls.push('cancelled'),
    rejectPending: (reason) => calls.push(`reject:${reason}`),
  }
}

describe('확장 요청 등록 순서', () => {
  it('**등록이 send 보다 먼저다** — 뒤에 하면 어댑터가 연 턴을 놓친다', () => {
    const calls: string[] = []
    const session = new ChatSession(recordingTransport(calls), { binder: spyBinder(calls) })

    session.send('분석해줘', { extensionRequestId: 'req-1' })

    expect(calls).toEqual(['pending:req-1', 'send'])
  })

  it('사용자 턴은 등록하지 않는다 — 남의 턴으로 확장 약속이 풀리면 안 된다', () => {
    const calls: string[] = []
    const session = new ChatSession(recordingTransport(calls), { binder: spyBinder(calls) })

    session.send('그냥 질문')

    expect(calls).toEqual(['send'])
  })

  it('못 보냈으면 방금 등록한 것을 되돌린다', () => {
    const calls: string[] = []
    const dead = {
      connect: () => Promise.resolve(),
      close: () => {},
      send: () => {
        calls.push('send')
        return false
      },
      onMessage: () => () => {},
      onClose: () => () => {},
      onError: () => () => {},
    } as unknown as Transport
    const session = new ChatSession(dead, { binder: spyBinder(calls) })

    session.send('분석해줘', { extensionRequestId: 'req-1' })

    expect(calls).toEqual(['pending:req-1', 'send', 'reject:연결이 끊겨 보내지 못했습니다'])
  })
})
