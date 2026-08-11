import { describe, it, expect } from 'vitest'
import { ChatSession } from './chatSession'
import type { Transport, Unsubscribe } from '../ws/transport'

// 회귀 방지: 한 세션은 하나의 chatId 만 써야 한다.
// 첫 요청은 chatId 없이 나가고, 서버가 응답 프레임에 chatId 를 실어 주면
// 그 뒤 요청부터 **같은 chatId** 를 실어 보내야 한다. 안 그러면 런타임이 매 턴
// 새 chat_id(=새 이력 thread)를 만들어 채팅이력이 턴마다 쌓인다.

class FakeTransport implements Transport {
  readonly isOpen = true
  readonly sent: string[] = []
  private messageHandler: ((raw: string) => void) | null = null

  send(payload: string): boolean {
    this.sent.push(payload)
    return true
  }
  onOpen(): Unsubscribe {
    return () => {}
  }
  onMessage(handler: (raw: string) => void): Unsubscribe {
    this.messageHandler = handler
    return () => {
      this.messageHandler = null
    }
  }
  onClose(): Unsubscribe {
    return () => {}
  }
  onError(): Unsubscribe {
    return () => {}
  }
  close(): void {}

  /** 서버가 보낸 것처럼 프레임을 밀어 넣는다 */
  inject(frame: Record<string, unknown>): void {
    this.messageHandler?.(JSON.stringify(frame))
  }
}

/** 보낸 프레임의 봉투 chatId 를 읽는다 */
function sentChatId(raw: string): unknown {
  return (JSON.parse(raw) as Record<string, unknown>)['chatId']
}

describe('ChatSession chatId 재사용', () => {
  it('서버가 발급한 chatId 를 잡아 다음 요청부터 실어 보낸다 (한 세션=한 chatId)', () => {
    const transport = new FakeTransport()
    const session = new ChatSession(transport)
    session.start()

    // 1) 첫 질문 — 아직 chatId 없음
    session.send('첫 질문')
    const first = transport.sent.find((raw) => raw.includes('chat_request'))!
    expect(sentChatId(first)).toBeUndefined()

    // 2) 서버가 새 chat_id 를 발급해 스트림 프레임에 실어 보낸다 (chat_service.py:1428-9)
    transport.inject({ kind: 'chat', action: 'stream_start', chatId: 'gen-abc-123', streamId: 's1', data: {} })

    // 3) 둘째 질문 — 이제 그 chatId 가 실려 나가야 한다
    transport.sent.length = 0
    session.send('둘째 질문')
    const second = transport.sent.find((raw) => raw.includes('chat_request'))!
    expect(sentChatId(second)).toBe('gen-abc-123')
  })

  it('이력 재생의 chat_request 프레임으로 사용자 질문을 복원한다', () => {
    const transport = new FakeTransport()
    const session = new ChatSession(transport)
    const snaps: { messages: { author: string; content: string }[] }[] = []
    session.onSnapshot((s) => snaps.push(s as never))
    session.start()

    // 서버(재생)가 사용자의 chat_request 를 되돌려 보낸다
    transport.inject({ kind: 'chat', action: 'chat_request', data: { query: '이게 뭐야?' } })

    const last = snaps.at(-1)!
    expect(last.messages.some((m) => m.author === 'user' && m.content === '이게 뭐야?')).toBe(true)
  })
})
