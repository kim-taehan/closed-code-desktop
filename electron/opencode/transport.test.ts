import { describe, expect, it } from 'vitest'
import { Handshake } from '../session/handshake'
import { OpencodeTransport } from './transport'

// 이 파일의 목적은 조각 검증이 아니라 **실제 Handshake 가 이 어댑터로 4단계를 통과하는가** 다.
// 위층을 고치지 않는 것이 부패방지 계층의 계약이므로, 위층 진짜 코드를 그대로 물려 확인한다.

interface Recorded {
  url: string
  method: string
  body: unknown
}

/** SSE 를 손으로 밀어 넣을 수 있는 가짜 서버 */
function fakeServer() {
  const calls: Recorded[] = []
  let push: ((chunk: string) => void) | null = null
  let closeStream: (() => void) | null = null

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })

    if (url.includes('/event')) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (chunk) => controller.enqueue(encoder.encode(chunk))
          closeStream = () => controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    }
    if (url.includes('/api/session') && method === 'POST' && url.endsWith('/api/session')) {
      // **`/api/*` 응답은 `{ data: ... }` 로 감싸여 온다** — 실측 그대로 흉내낸다.
      // 감싸지 않은 가짜를 쓰면 클라이언트의 언랩 버그를 테스트가 못 잡는다 (실제로 놓쳤다).
      return new Response(JSON.stringify({ data: { id: 'ses_fake' } }), { status: 200 })
    }
    return new Response('', { status: 200 })
  }) as unknown as typeof fetch

  return {
    calls,
    fetchImpl,
    /** `/api/event` 와 같은 봉투로 민다 — 페이로드는 `properties` 가 아니라 `data` 다 */
    emit(type: string, data: Record<string, unknown> = {}) {
      push?.(`data: ${JSON.stringify({ id: 'evt_1', type, data })}\n\n`)
    },
    end() {
      closeStream?.()
    },
    get lastCall() {
      return calls[calls.length - 1]
    },
    find(predicate: (call: Recorded) => boolean) {
      return calls.find(predicate)
    },
  }
}

function makeTransport(server: ReturnType<typeof fakeServer>) {
  return new OpencodeTransport({
    baseUrl: 'http://127.0.0.1:4096',
    fetchImpl: server.fetchImpl,
    autoReconnect: false,
  })
}

/** 이벤트 루프를 몇 번 돌려 SSE 펌프와 fetch 프로미스가 진행되게 한다 */
async function tick(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('핸드셰이크 4단계', () => {
  it('server.connected 만으로 auth·workspace 를 합성해 ready 까지 간다', async () => {
    const server = fakeServer()
    const transport = makeTransport(server)
    const handshake = new Handshake(transport, {
      workspacePath: '/tmp/proj',
      projectName: 'proj',
    })

    const done = handshake.run()
    transport.open()
    await tick()

    // opencode 가 SSE 를 열자마자 보내는 첫 이벤트
    server.emit('server.connected')
    await tick()

    await expect(done).resolves.toBeUndefined()
    expect(handshake.state.stage).toBe('ready')

    // 워크스페이스는 opencode 세션 생성으로 옮겨졌다
    const created = server.find((call) => call.url.endsWith('/api/session') && call.method === 'POST')
    expect(created?.body).toEqual({ location: { directory: '/tmp/proj' } })

    transport.close()
  })

  it('세션 응답에 id 가 없으면 조용히 넘어가지 않고 오류를 화면까지 올린다', async () => {
    // 회귀: `/api/*` 응답이 `{data:...}` 로 감싸인 것을 몰라 id 가 undefined 로 새고,
    // 증상이 "핸드셰이크는 ready 인데 채팅 무응답" 으로만 나타났다.
    const server = fakeServer()
    const original = server.fetchImpl
    const brokenFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/session') && (init?.method ?? 'GET') === 'POST') {
        return new Response(JSON.stringify({ data: { projectID: 'global' } }), { status: 200 })
      }
      return original(input as never, init as never)
    }) as unknown as typeof fetch

    const transport = new OpencodeTransport({
      baseUrl: 'http://127.0.0.1:4096',
      fetchImpl: brokenFetch,
      autoReconnect: false,
    })
    const seen: string[] = []
    transport.onMessage((raw) => seen.push(raw))
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()

    transport.send(
      JSON.stringify({
        kind: 'workspace',
        action: 'workspace_sync',
        reqId: 'r',
        data: { workspace: { workspacePath: '/tmp/p' } },
      }),
    )
    await tick()

    expect(seen.some((raw) => raw.includes('id 가 없습니다'))).toBe(true)
    expect(seen.some((raw) => raw.includes('workspace_state'))).toBe(false)
    transport.close()
  })

  it('workspacePath 가 비면 세션을 만들지 않고 오류로 알린다', async () => {
    const server = fakeServer()
    const transport = makeTransport(server)
    const seen: string[] = []
    transport.onMessage((raw) => seen.push(raw))
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()

    transport.send(
      JSON.stringify({ kind: 'workspace', action: 'workspace_sync', reqId: 'r', data: { workspace: {} } }),
    )
    await tick()

    expect(seen.some((raw) => raw.includes('NO_WORKSPACE'))).toBe(true)
    expect(server.find((call) => call.url.endsWith('/api/session') && call.method === 'POST')).toBeUndefined()
    transport.close()
  })
})

describe('채팅', () => {
  async function readySession() {
    const server = fakeServer()
    const transport = makeTransport(server)
    const frames: string[] = []
    transport.onMessage((raw) => frames.push(raw))
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()
    transport.send(
      JSON.stringify({
        kind: 'workspace',
        action: 'workspace_sync',
        reqId: 'r',
        data: { workspace: { workspacePath: '/tmp/proj' } },
      }),
    )
    await tick()
    return { server, transport, frames }
  }

  it('chat_request 는 stream_start 를 먼저 내고 prompt 를 쏜다', async () => {
    const { server, transport, frames } = await readySession()
    transport.send(
      JSON.stringify({ kind: 'chat', action: 'chat_request', reqId: 'r', data: { query: '안녕' } }),
    )
    await tick()

    const start = frames.map((f) => JSON.parse(f)).find((f) => f.action === 'stream_start')
    expect(start).toBeDefined()
    expect(typeof start.streamId).toBe('string')

    const prompt = server.find((call) => call.url.endsWith('/prompt'))
    expect(prompt?.url).toBe('http://127.0.0.1:4096/api/session/ses_fake/prompt')
    expect(prompt?.body).toEqual({ prompt: { text: '안녕' } })
    transport.close()
  })

  it('세션 전에 보낸 chat_request 는 오류로 되돌려준다', async () => {
    const server = fakeServer()
    const transport = makeTransport(server)
    const frames: string[] = []
    transport.onMessage((raw) => frames.push(raw))
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()

    transport.send(JSON.stringify({ kind: 'chat', action: 'chat_request', reqId: 'r', data: { query: 'x' } }))
    await tick()
    expect(frames.some((f) => f.includes('NO_SESSION'))).toBe(true)
    transport.close()
  })

  it('stream_cancel 은 interrupt 로 간다 (abort 가 아니다)', async () => {
    const { server, transport } = await readySession()
    transport.send(JSON.stringify({ kind: 'chat', action: 'stream_cancel', reqId: 'r', data: {} }))
    await tick()
    expect(server.find((call) => call.url.endsWith('/interrupt'))).toBeDefined()
    transport.close()
  })

  it('다른 세션의 이벤트는 걸러낸다 — /event 는 서버 전역이다', async () => {
    const { server, transport, frames } = await readySession()
    const before = frames.length
    server.emit('session.idle', { sessionID: 'ses_다른창' })
    await tick()
    expect(frames.length).toBe(before)
    transport.close()
  })
})

describe('승인 응답 매핑', () => {
  async function approve(body: Record<string, unknown>) {
    const server = fakeServer()
    const transport = makeTransport(server)
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()
    transport.send(
      JSON.stringify({
        kind: 'workspace',
        action: 'workspace_sync',
        reqId: 'r',
        data: { workspace: { workspacePath: '/tmp/p' } },
      }),
    )
    await tick()
    transport.send(JSON.stringify({ kind: 'chat', action: 'tool_approval_response', reqId: 'r', data: body }))
    await tick()
    const call = server.find((c) => c.url.includes('/permission/'))
    transport.close()
    return call
  }

  it('거부 → reject', async () => {
    expect((await approve({ requestId: 'per_1', approved: false }))?.body).toEqual({ reply: 'reject' })
  })

  it('한 번 승인 → once', async () => {
    expect((await approve({ requestId: 'per_1', approved: true }))?.body).toEqual({ reply: 'once' })
  })

  it('범위 승인(session_allow) → always — opencode 는 범위 구분이 없다', async () => {
    const call = await approve({ requestId: 'per_1', approved: true, followUp: 'session_allow' })
    expect(call?.body).toEqual({ reply: 'always' })
    expect(call?.url).toBe('http://127.0.0.1:4096/api/session/ses_fake/permission/per_1/reply')
  })
})
