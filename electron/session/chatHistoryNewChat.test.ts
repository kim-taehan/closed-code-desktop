import { describe, it, expect } from 'vitest'
import { ChatHistoryController, type ChatHistoryState } from './chatHistory'
import type { Transport, Unsubscribe } from '../ws/transport'

// VS Code 방식: ready 되면 chat_history_add 로 chat_id 를 발급받아 세션에 심는다.
// 이게 한 대화=한 이력의 근거 — 매 턴 null 로 보내 새 이력이 쌓이던 것을 막는다.

class FakeTransport implements Transport {
  readonly isOpen = true
  readonly sent: string[] = []
  private handler: ((raw: string) => void) | null = null
  send(payload: string): boolean {
    this.sent.push(payload)
    return true
  }
  onOpen(): Unsubscribe {
    return () => {}
  }
  onMessage(handler: (raw: string) => void): Unsubscribe {
    this.handler = handler
    return () => {}
  }
  onClose(): Unsubscribe {
    return () => {}
  }
  onError(): Unsubscribe {
    return () => {}
  }
  close(): void {}
  inject(frame: Record<string, unknown>): void {
    this.handler?.(JSON.stringify(frame))
  }
}

describe('chat_history_add 로 chat_id 발급', () => {
  it('requestNewChat 은 chat_history_add 를 보내고, 응답의 chat_id 를 onNewChatId 로 알린다', () => {
    const transport = new FakeTransport()
    const history = new ChatHistoryController(transport)
    history.start()

    const issued: string[] = []
    history.onNewChatId((id) => issued.push(id))

    // 발급 요청 — chat_history_add 프레임이 나가야 한다
    history.requestNewChat()
    const addFrame = transport.sent.find((raw) => raw.includes('chat_history_add'))
    expect(addFrame).toBeTruthy()

    // 서버가 새 chat_id 를 실어 응답 (snake_case 도메인)
    transport.inject({
      kind: 'chat_history',
      action: 'chat_history_add',
      data: { state: 'ready', chat_id: 'new-abc-123' },
    })

    expect(issued).toEqual(['new-abc-123'])
  })

  it('현재 대화 제목: 발급→헤더 비어있음, /rename·자동제목이 헤더에 반영된다', () => {
    const transport = new FakeTransport()
    const history = new ChatHistoryController(transport)
    const states: ChatHistoryState[] = []
    history.onStateChange((s) => states.push(s))
    history.start()

    // 발급되면 current 가 그 대화(제목은 아직 빈)
    transport.inject({ kind: 'chat_history', action: 'chat_history_add', data: { chat_id: 'c1' } })
    expect(states.at(-1)!.current).toEqual({ chatId: 'c1', title: '' })

    // /rename — 헤더 제목 즉시 반영 + rename 프레임 전송
    transport.sent.length = 0
    history.renameCurrent('내 대화')
    expect(states.at(-1)!.current).toEqual({ chatId: 'c1', title: '내 대화' })
    expect(transport.sent.find((r) => r.includes('chat_history_rename'))).toBeTruthy()

    // 런타임 자동 제목(chat_history_title)도 현재 대화면 헤더에 반영
    transport.inject({ kind: 'chat_history', action: 'chat_history_title', data: { chat_id: 'c1', title: '자동 제목' } })
    expect(states.at(-1)!.current).toEqual({ chatId: 'c1', title: '자동 제목' })
  })
})
