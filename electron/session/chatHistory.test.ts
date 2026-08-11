import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntimeServer } from '../../tests/fake-runtime/FakeRuntimeServer'
import { textOnlyTurn } from '../../tests/fake-runtime/turnScript'
import { WsConnection } from '../ws/connection'
import { Handshake } from './handshake'
import { ChatHistoryController } from './chatHistory'
import type { ChatHistoryState } from './chatHistory'

// 채팅 이력.
// ⚠️ 이 도메인은 snake_case 가 정본이다 — chat 도메인과 반대라 실수하기 쉽다.

let server: FakeRuntimeServer | null = null
let connection: WsConnection | null = null

afterEach(async () => {
  connection?.dispose()
  connection = null
  await server?.stop()
  server = null
})

const SAMPLE = [
  { chat_id: 'c1', title: '첫 대화', created_at: '2026-07-19T10:00:00Z', message_count: 3 },
  { chat_id: 'c2', title: '둘째 대화', created_at: '2026-07-20T10:00:00Z', message_count: 7 },
]

async function setup(options: ConstructorParameters<typeof FakeRuntimeServer>[0] = {}) {
  server = new FakeRuntimeServer({ history: SAMPLE, ...options })
  const port = await server.start()
  connection = new WsConnection({ url: `ws://127.0.0.1:${port}/ws`, autoReconnect: false })

  const history = new ChatHistoryController(connection)
  const states: ChatHistoryState[] = []
  history.onStateChange((state) => states.push(state))
  history.start()

  const handshake = new Handshake(connection, { workspacePath: '/tmp' })
  const ready = handshake.run()
  await connection.connect()
  await ready

  return { history, states, handshake, server: server!, connection: connection! }
}

describe('목록 조회', () => {
  it('snake_case 응답을 화면용 모양으로 바꾼다', async () => {
    const ctx = await setup()
    ctx.history.requestList()

    await vi.waitFor(() => expect(ctx.history.state.entries).toHaveLength(2))
    expect(ctx.history.state.entries[0]).toMatchObject({
      chatId: 'c1',
      title: '첫 대화',
      createdAt: '2026-07-19T10:00:00Z',
      messageCount: 3,
    })
    ctx.handshake.dispose()
  })

  it('제목이 없으면 chatId 앞자리로 만든다', async () => {
    const ctx = await setup({ history: [{ chat_id: 'abcdef123456' }] })
    ctx.history.requestList()

    await vi.waitFor(() => expect(ctx.history.state.entries).toHaveLength(1))
    expect(ctx.history.state.entries[0]!.title).toBe('대화 abcdef12')
    ctx.handshake.dispose()
  })

  it('chat_id 가 없는 항목은 버린다', async () => {
    const ctx = await setup({ history: [{ title: '깨진 항목' }, { chat_id: 'ok' }] })
    ctx.history.requestList()

    await vi.waitFor(() => expect(ctx.history.state.entries).toHaveLength(1))
    expect(ctx.history.state.entries[0]!.chatId).toBe('ok')
    ctx.handshake.dispose()
  })
})

describe('이력 불러오기', () => {
  it('요청에 chat_id 를 snake_case 로 보낸다', async () => {
    const ctx = await setup()
    ctx.history.load('c1')

    await vi.waitFor(() => {
      const sent = ctx.server.received.find((f) => f.action === 'chat_history_load')
      expect(sent?.data).toEqual({ chat_id: 'c1' })
    })
    ctx.handshake.dispose()
  })

  it('불러오는 동안 loading 이 true 다', async () => {
    const ctx = await setup({ onHistoryLoad: () => [] })
    ctx.history.load('c1')

    // 요청 직후엔 로딩 중이어야 한다
    expect(ctx.history.state.loading).toBe(true)
    expect(ctx.history.state.loadingChatId).toBe('c1')

    await vi.waitFor(() => expect(ctx.history.state.loading).toBe(false))
    ctx.handshake.dispose()
  })

  it('완료를 알린다', async () => {
    const ctx = await setup({ onHistoryLoad: () => [] })
    const completed: string[] = []
    ctx.history.onLoadComplete((chatId) => completed.push(chatId))

    ctx.history.load('c2')
    await vi.waitFor(() => expect(completed).toEqual(['c2']))
    ctx.handshake.dispose()
  })

  it('지난 프레임을 다시 흘려보낸다', async () => {
    const ctx = await setup({
      onHistoryLoad: (chatId) =>
        textOnlyTurn(
          { reqId: 'replay', streamId: 's-replay', chatId, turnId: 'turn-old' },
          '예전 답변',
        ),
    })

    const frames: Record<string, unknown>[] = []
    ctx.connection.onMessage((raw) => frames.push(JSON.parse(raw) as Record<string, unknown>))

    ctx.history.load('c1')
    await vi.waitFor(() => {
      expect(frames.some((f) => f['action'] === 'stream_chunk')).toBe(true)
      expect(frames.some((f) => f['action'] === 'chat_history_load_complete')).toBe(true)
    })
    ctx.handshake.dispose()
  })

  it('오류가 나면 로딩 상태를 푼다 — 영원히 로딩 중으로 남지 않게', async () => {
    const ctx = await setup()
    ctx.history.load('c1')
    expect(ctx.history.state.loading).toBe(true)

    ctx.server.push([
      { kind: 'chat_history', action: 'error', data: { code: 'SERVICE_ERROR', message: '실패' } },
    ])

    await vi.waitFor(() => expect(ctx.history.state.loading).toBe(false))
    ctx.handshake.dispose()
  })
})

describe('삭제와 이름 변경', () => {
  it('삭제하면 목록을 다시 받아온다', async () => {
    const ctx = await setup()
    ctx.history.requestList()
    await vi.waitFor(() => expect(ctx.history.state.entries).toHaveLength(2))

    ctx.history.remove('c1')
    await vi.waitFor(() => expect(ctx.history.state.entries).toHaveLength(1))
    expect(ctx.history.state.entries[0]!.chatId).toBe('c2')
    ctx.handshake.dispose()
  })

  it('이름을 바꾸면 목록에 반영된다', async () => {
    const ctx = await setup()
    ctx.history.requestList()
    await vi.waitFor(() => expect(ctx.history.state.entries).toHaveLength(2))

    ctx.history.rename('c1', '새 제목')
    await vi.waitFor(() => {
      expect(ctx.history.state.entries.find((e) => e.chatId === 'c1')?.title).toBe('새 제목')
    })
    ctx.handshake.dispose()
  })

  it('모르는 chatId 의 제목 변경은 무시한다', async () => {
    const ctx = await setup()
    ctx.history.requestList()
    await vi.waitFor(() => expect(ctx.history.state.entries).toHaveLength(2))

    ctx.server.push([
      { kind: 'chat_history', action: 'chat_history_title', data: { chat_id: '없는id', title: 'x' } },
    ])

    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(ctx.history.state.entries.map((e) => e.title)).toEqual(['첫 대화', '둘째 대화'])
    ctx.handshake.dispose()
  })
})

describe('snake_case 계약', () => {
  it('camelCase 로 보내면 runtime 이 거부한다 — 이 도메인은 snake_case 다', async () => {
    const ctx = await setup()
    const frames: Record<string, unknown>[] = []
    ctx.connection.onMessage((raw) => frames.push(JSON.parse(raw) as Record<string, unknown>))

    ctx.connection.send(
      JSON.stringify({
        kind: 'chat_history',
        action: 'chat_history_load',
        reqId: 'h1',
        data: { chatId: 'c1' },
      }),
    )

    await vi.waitFor(() => {
      const error = frames.find(
        (f) => f['action'] === 'error' && String((f['data'] as Record<string, unknown>)['message']).includes('chat_id'),
      )
      expect(error).toBeTruthy()
    })
    ctx.handshake.dispose()
  })
})
