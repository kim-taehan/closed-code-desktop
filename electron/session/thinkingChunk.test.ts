import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageKind } from '../../shared/ipc/messageTypes'
import {
  streamEnd,
  streamStart,
  textChunk,
  thinkingChunk,
  turnEnd,
  turnStart,
} from '../../tests/fake-runtime/turnScript'
import {
  connectAndHandshake,
  countOf,
  textsOf,
  type SessionFixture,
} from '../../tests/fake-runtime/chatSessionKit'
import type { ChatSnapshot } from './chatSession'
import { setup } from './chunkTestKit'

// 추론(thinking) 청크 (DC-1029/1030).
//
// 런타임 계약: domains/chat.py:141-147 — segmentId 없이 stream_chunk 로 오고,
// 버블 묶기는 IDE 몫이다 ("첫 thinking 청크에 블록 생성 → TextMessage 도착 시 닫기").

describe('thinking 청크', () => {
  it('추론 전용 kind 로 메시지를 만든다 — 답변(TEXT)과 섞이지 않는다', () => {
    const { messages, turns, router } = setup()
    turns.onTurnStart('t1')
    router.route({ messageType: 'thinking', message: '먼저 파일부터 보자' }, 'stream-1')

    const message = messages.messages[0]!
    expect(message.kind).toBe(MessageKind.THINKING)
    expect(message.content).toBe('먼저 파일부터 보자')
    expect(message.turnId).toBe('t1')
    expect(message.streamId).toBe('stream-1')
  })

  it('화면이 바뀌었다고 알리되 이벤트는 내지 않는다', () => {
    const { router } = setup()
    const result = router.route({ messageType: 'thinking', message: '음…' }, 'stream-1')

    // changed=false 면 스냅샷이 안 밀려 화면에 영영 안 나온다
    expect(result.changed).toBe(true)
    // effect 를 내면 스피너·reply 추출이 추론을 답변으로 오인한다
    expect(result.effect).toBeUndefined()
  })

  it('표에 없는 타입으로 취급되지 않는다', () => {
    const unknown: string[] = []
    const { router } = setup((type) => unknown.push(type))
    router.route({ messageType: 'thinking', message: '음…' }, 'stream-1')
    expect(unknown).toEqual([])
  })

  it('빈 추론은 메시지를 만들지 않는다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'thinking', message: '' }, 'stream-1')
    expect(messages.messages).toHaveLength(0)
  })

  it('같은 stream 의 연속 추론은 한 버블로 이어붙는다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'thinking', message: '먼저 ' }, 'stream-1')
    router.route({ messageType: 'thinking', message: '파일을 ' }, 'stream-1')
    router.route({ messageType: 'thinking', message: '보자' }, 'stream-1')

    expect(messages.messages).toHaveLength(1)
    expect(messages.messages[0]!.content).toBe('먼저 파일을 보자')
  })

  it('stream 이 바뀌면 새 추론 버블이 열린다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'thinking', message: '이전 턴' }, 'stream-1')
    router.route({ messageType: 'thinking', message: '다음 턴' }, 'stream-2')

    expect(messages.messages).toHaveLength(2)
  })

  it('답변(text)이 도착하면 추론 블록이 닫히고 별도 버블이 열린다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'thinking', message: '고민 중' }, 'stream-1')
    router.route({ messageType: 'text', message: '답변입니다' }, 'stream-1')

    expect(messages.messages.map((m) => m.kind)).toEqual([MessageKind.THINKING, MessageKind.TEXT])
    expect(messages.messages[0]!.content).toBe('고민 중')
    expect(messages.messages[1]!.content).toBe('답변입니다')
  })

  it('답변 뒤에 다시 추론이 오면 또 새 블록이 된다 — 답변에 섞여 들어가지 않는다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'thinking', message: '1차' }, 'stream-1')
    router.route({ messageType: 'text', message: '중간 답변' }, 'stream-1')
    router.route({ messageType: 'thinking', message: '2차' }, 'stream-1')

    expect(messages.messages.map((m) => m.kind)).toEqual([
      MessageKind.THINKING,
      MessageKind.TEXT,
      MessageKind.THINKING,
    ])
    expect(messages.messages[1]!.content).toBe('중간 답변')
  })

  it('서브에이전트 레인의 추론은 주 대화에 올라오지 않는다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'thinking', message: '서브 고민', taskId: 'a1' }, 'stream-1')
    expect(messages.messages).toHaveLength(0)
  })
})

// ── 실제 소켓 경로 ─────────────────────────────────────
//
// 위 단위 테스트는 라우터만 본다. 여기서는 가짜 런타임 → WS → ChatSession →
// 스냅샷까지 실제로 흘려, 추론이 도중에 사라지지 않는지 확인한다.

describe('가짜 런타임에서 추론 청크를 받는다', () => {
  let fixture: SessionFixture | null = null

  afterEach(async () => {
    await fixture?.dispose()
    fixture = null
  })

  it('추론이 스냅샷에 남고 text 이벤트로는 새지 않는다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => {
        const turn = { ...context, turnId: 'turn-1' }
        return [
          streamStart(turn),
          turnStart(turn),
          thinkingChunk(turn, '먼저 파일부터 '),
          thinkingChunk(turn, '확인하자'),
          textChunk(turn, '고쳤습니다'),
          turnEnd(turn),
          streamEnd(turn, { terminal: true, failed: false }),
        ]
      },
    })

    const snapshots: ChatSnapshot[] = []
    fixture.chat.onSnapshot((snapshot) => snapshots.push(snapshot))
    fixture.chat.send('고쳐줘')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'turn_ended')).toBe(1))

    const messages = snapshots.at(-1)?.messages ?? []
    const thinkingMessages = messages.filter((m) => m.kind === MessageKind.THINKING)

    // 두 청크가 한 버블로 합쳐진다
    expect(thinkingMessages).toHaveLength(1)
    expect(thinkingMessages[0]!.content).toBe('먼저 파일부터 확인하자')

    // 답변은 따로 남는다
    expect(messages.some((m) => m.kind === MessageKind.TEXT && m.content === '고쳤습니다')).toBe(true)

    // 추론이 답변 이벤트로 새면 스피너·reply 추출이 오작동한다
    expect(textsOf(fixture.events)).toEqual(['고쳤습니다'])
  })
})
