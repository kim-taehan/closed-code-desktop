import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { FakePtyStore } from './fakePty'
import { turnScript } from './turnScript'

// 가짜 opencode 헤드리스 서버. davis 시절 `tests/fake-runtime` 이 하던 자리를 대신한다.
//
// 실물의 **계약을 그대로** 흉내내는 것이 목적이다. 실물과 어긋난 가짜는 초록을 주면서
// 버그를 통과시킨다 (실제로 겪었다 — `{data:...}` 래핑과 `data`/`properties` 필드명).
// 그래서 아래 셋은 반드시 실물과 같게 둔다:
//
//   1. **`POST /api/session`** 은 `{ data: ... }` 로 감싼다 (실물도 `data` 단독이다).
//      ⚠️ **`/api/*` 전체가 그런 것은 아니다.** 봉투가 세 모양이고(`{location,data}` 11 ·
//      `{data}` 2 · `{data,cursor}` 1) 아예 안 감싸는 것도 있다 (`/api/health`·`/api/location`).
//      `fakePty.ts` 가 `{location, data}` 를 쓰는 것은 어긋난 게 아니라 **pty 계열 실물이
//      그렇기 때문**이다. 여기에 GET 을 더할 때는 그 경로를 실측하고 맞춘다 —
//      전수는 `README.md` 실측 함정 4.
//   2. SSE 이벤트의 페이로드 필드는 **`properties`** 다 — 레거시 `/event` 가 그렇다.
//   3. `/event` 는 **서버 전역**이다 — 모든 세션의 이벤트가 모든 구독자에게 간다
//      (세션 격리는 클라이언트가 sessionID 로 거른다)
//   4. **채팅은 레거시 세대다** — 프롬프트 `POST /session/:id/prompt_async` 는 본문 없이
//      **204**, 중단 `POST /session/:id/abort` 는 **200 에 본문 `true`**, 스트림은 `/event`.
//      셋 다 실물 실측이고, 하나라도 신규(`/api/…`) 로 두면 이 가짜는 어댑터가 세대를
//      잘못 짝지어도 초록을 준다 — 그게 이 전환에서 가장 위험한 실패였다.

export interface PromptContext {
  sessionID: string
  text: string
  directory: string
}

export interface FakeOpencodeOptions {
  /** prompt 를 받으면 재생할 이벤트. 기본은 도구 없이 텍스트 한 번 + 턴 종료. */
  turn?: (context: PromptContext) => Array<Record<string, unknown>>
  /** 이벤트 사이 간격(ms). 0 이면 즉시 연달아 민다. */
  gapMs?: number
}

let sessionCounter = 0

export class FakeOpencodeServer {
  private server: Server | null = null
  private port = 0
  private clients = new Set<ServerResponse>()
  private directories = new Map<string, string>()

  /** 받은 요청 기록 — 테스트가 "무엇을 보냈나"를 확인한다 */
  readonly calls: Array<{ method: string; url: string; body: unknown }> = []
  /** 셸 드로어가 쓰는 `/api/pty` (`fakePty.ts`). 격리는 디렉토리로 갈린다 — 실물과 같다. */
  readonly pty = new FakePtyStore()

  constructor(private readonly options: FakeOpencodeOptions = {}) {}

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async start(): Promise<number> {
    this.server = createServer((request, response) => void this.handle(request, response))
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    const address = this.server.address()
    this.port = typeof address === 'object' && address ? address.port : 0
    return this.port
  }

  async stop(): Promise<void> {
    for (const client of this.clients) client.end()
    this.clients.clear()
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
    })
    this.server = null
  }

  /** 임의 이벤트를 모든 구독자에게 민다. 레거시 `/event` 처럼 페이로드는 `properties` 에 싣는다. */
  emit(type: string, data: Record<string, unknown> = {}): void {
    const payload = { id: `evt_${Math.random().toString(36).slice(2)}`, type, properties: data }
    const frame = `data: ${JSON.stringify(payload)}\n\n`
    for (const client of this.clients) client.write(frame)
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? ''

    // ⚠️ `/api/event` 가 아니다. 어댑터가 신규 스트림을 구독하면 여기서 안 걸려 붙지 못한다 —
    // 세대를 잘못 짝지은 것을 이 가짜가 잡아 주는 자리다.
    if (request.method === 'GET' && url.startsWith('/event')) return this.openStream(response)

    const body = await readJson(request)
    this.calls.push({ method: request.method ?? 'GET', url, body })

    if (this.pty.matches(url)) return this.pty.handle(request, url, body, response)

    if (request.method === 'POST' && url === '/api/session') return this.createSession(body, response)

    const prompt = /^\/session\/([^/]+)\/prompt_async$/.exec(url)
    if (request.method === 'POST' && prompt) return this.prompt(prompt[1]!, body, response)

    // 레거시 중단은 본문이 `true` 다 (`{data:...}` 래핑 없음 — 실물 그대로).
    if (request.method === 'POST' && /^\/session\/[^/]+\/abort$/.test(url)) {
      return send(response, 200, true)
    }

    // permission reply·question reply 는 기록만 하고 성공으로 답한다.
    send(response, 200, { data: {} })
  }

  private openStream(response: ServerResponse): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    this.clients.add(response)
    response.on('close', () => this.clients.delete(response))
    // 실물이 스트림을 열자마자 보내는 첫 이벤트. 핸드셰이크가 이걸 기다린다.
    const connected = { id: 'evt_conn', type: 'server.connected', properties: {} }
    response.write(`data: ${JSON.stringify(connected)}\n\n`)
  }

  private createSession(body: unknown, response: ServerResponse): void {
    sessionCounter += 1
    const id = `ses_fake${sessionCounter}`
    const location = (body as { location?: { directory?: string } } | undefined)?.location
    this.directories.set(id, location?.directory ?? '')
    send(response, 200, { data: { id, projectID: 'global' } })
  }

  private prompt(sessionID: string, body: unknown, response: ServerResponse): void {
    // 레거시 본문은 `{parts:[{type:'text', text}]}` 다 — 신규의 `{prompt:{text}}` 가 아니다.
    const parts = (body as { parts?: Array<{ type?: string; text?: string }> } | undefined)?.parts ?? []
    const text = parts.find((part) => part.type === 'text')?.text ?? ''
    // 실물은 접수 즉시 **204(본문 없음)** 로 반환하고 턴은 SSE 로 흐른다.
    response.writeHead(204)
    response.end()

    const context: PromptContext = { sessionID, text, directory: this.directories.get(sessionID) ?? '' }
    const events = (this.options.turn ?? turnScript)(context)
    const gap = this.options.gapMs ?? 0
    events.forEach((event, index) => {
      const emit = () => this.emit(String(event['type']), event['data'] as Record<string, unknown>)
      if (gap <= 0) setImmediate(emit)
      else setTimeout(emit, gap * (index + 1))
    })
  }
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload)
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(text)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}
