import { OpencodeTransport } from './transport'

// 어댑터 테스트용 하네스. SSE 를 손으로 밀어 넣는 가짜 서버와 이벤트 루프 펌프.
//
// `transport.test.ts` 에 있던 것을 뺐다 — 그 파일이 300줄 상한에 닿아서다.
// 하네스를 따로 두면 어댑터 테스트를 파일로 갈라도 같은 가짜 서버를 쓴다.

interface Recorded {
  url: string
  method: string
  body: unknown
}

/** SSE 를 손으로 밀어 넣을 수 있는 가짜 서버 */
export function fakeServer() {
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
    /** 레거시 `/event` 와 같은 봉투로 민다 — 페이로드는 `data` 가 아니라 `properties` 다 */
    emit(type: string, properties: Record<string, unknown> = {}) {
      push?.(`data: ${JSON.stringify({ id: 'evt_1', type, properties })}\n\n`)
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

export function makeTransport(server: ReturnType<typeof fakeServer>) {
  return new OpencodeTransport({
    baseUrl: 'http://127.0.0.1:4096',
    fetchImpl: server.fetchImpl,
    autoReconnect: false,
  })
}

/** 이벤트 루프를 몇 번 돌려 SSE 펌프와 fetch 프로미스가 진행되게 한다 */
export async function tick(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 채팅을 거칠 준비된 세션 — 가짜 서버·transport·누린 프레임을 한 세트로 준다. */
export async function readySession() {
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
