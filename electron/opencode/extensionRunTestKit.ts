import { ExtensionAiRuns } from './extensionRun'

// `code.ai.run` 시험용 가짜 opencode. **실물 계약을 그대로** 흉내낸다 (2026-09-22 실측, 1.18.18):
//   - `/event` 는 **서버 전역**이다 — 연결이 여럿이면 전부에게 같은 이벤트가 간다. 붙자마자 `server.connected`
//   - 레거시 경로는 `{data}` 로 감싸지 않는다 — `POST /session?directory=` 는 세션 객체를 그대로 준다
//   - 모르는 세션은 `GET /session/:id` 도 `prompt_async` 도 404 `NotFoundError`
//   - `prompt_async` 204 · `abort` 200 `true` · 승인·질문 거절 200 `true`
// 실물과 어긋난 가짜는 초록을 주면서 버그를 통과시킨다 — 고칠 때는 실물이 그런지 먼저 잰다.

interface Recorded {
  method: string
  /** 경로 + 질의 */
  path: string
  body: unknown
}

/**
 * @param lateOnConnect 붙자마자 `server.connected` 와 **같은 청크로** 밀 이벤트. 끊은 턴의 늦은 idle 이
 *   다음 실행의 스트림에 먼저 닿는 경우를 흉내낸다 (`extensionRun.ts` 의 `prompted` 가드).
 */
export function fakeOpencode(known: string[] = [], lateOnConnect: [string, Record<string, unknown>][] = []) {
  const calls: Recorded[] = []
  const sessions = new Set(known)
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const encoder = new TextEncoder()
  let created = 0
  const text = (type: string, properties: Record<string, unknown>) =>
    `data: ${JSON.stringify({ id: 'evt_fake', type, properties })}\n\n`
  const frame = (type: string, properties: Record<string, unknown>) => encoder.encode(text(type, properties))
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
  const notFound = (id: string) => json({ name: 'NotFoundError', data: { message: `Session not found: ${id}` } }, 404)

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    const method = init?.method ?? 'GET'
    calls.push({ method, path: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const parts = url.pathname.split('/').filter(Boolean)

    if (url.pathname === '/event') {
      let mine: ReadableStreamDefaultController<Uint8Array> | null = null
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          mine = controller
          streams.add(controller)
          const late = lateOnConnect.map(([type, properties]) => text(type, properties))
          controller.enqueue(encoder.encode(text('server.connected', {}) + late.join('')))
        },
        cancel() {
          if (mine) streams.delete(mine)
        },
      })
      init?.signal?.addEventListener('abort', () => {
        if (mine) streams.delete(mine)
      })
      return new Response(body, { status: 200 })
    }
    if (method === 'POST' && url.pathname === '/session') {
      created += 1
      const id = `ses_ext${created}`
      sessions.add(id)
      return json({ id, title: (init?.body && (JSON.parse(String(init.body)) as { title?: string }).title) ?? '' })
    }
    if (parts[0] === 'session' && parts[1] !== undefined) {
      const id = parts[1]
      if (!sessions.has(id)) return notFound(id)
      if (method === 'GET' && parts.length === 2) return json({ id })
      if (parts[2] === 'prompt_async') return new Response(null, { status: 204 })
      if (parts[2] === 'abort') return json(true)
    }
    if (method === 'POST' && parts[0] === 'permission' && parts[2] === 'reply') return json(true)
    if (method === 'POST' && parts[0] === 'question' && parts[2] === 'reject') return json(true)
    return json({ name: 'NotFound' }, 404)
  }) as unknown as typeof fetch

  return {
    calls,
    fetchImpl,
    /** 서버 전역 스트림에 민다 — 열린 연결 전부가 받는다 */
    emit(type: string, properties: Record<string, unknown>) {
      for (const controller of streams) controller.enqueue(frame(type, properties))
    },
    /** 지금 열린 `/event` 연결 수 */
    get openStreams() {
      return streams.size
    },
    /** 마지막으로 만든 세션 id */
    get lastCreated() {
      return `ses_ext${created}`
    },
    paths(method: string) {
      return calls.filter((call) => call.method === method).map((call) => call.path)
    },
  }
}

/** 메모리 장부 — `ExtensionSessionStore` 의 `get`·`set` 만 */
export function memoryLedger(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    get: (extension: string, projectId: string) => map.get(`${extension}|${projectId}`),
    set: (extension: string, projectId: string, id: string) => void map.set(`${extension}|${projectId}`, id),
  }
}

export function makeRuns(server: ReturnType<typeof fakeOpencode>, ledger = memoryLedger()) {
  return new ExtensionAiRuns({
    sessions: ledger,
    server: async (projectId) => ({ url: 'http://127.0.0.1:4096', directory: `/tmp/${projectId}` }),
    fetchImpl: server.fetchImpl,
  })
}

/** 이벤트 루프를 몇 번 돌려 SSE 펌프와 fetch 가 진행되게 한다 */
export async function settle(times = 4): Promise<void> {
  for (let round = 0; round < times; round += 1) {
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
