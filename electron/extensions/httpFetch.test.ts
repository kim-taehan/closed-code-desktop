import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { METHOD_HTTP_FETCH } from './extensionApi'
import { dispatchExtensionApi, portsOf } from './serviceDispatch'
import { createRequest } from './rpc'
import { ExtensionWorkspace } from './workspaceApi'
import { HTTP_MAX_RESPONSE_BYTES } from './httpFetch'

// `code.http.fetch` — 확장이 바깥에 닿는 유일한 길 (하이닉스 요구사항 확장 §5-1, H1).
// **진짜 HTTP 서버를 직접 연다** (127.0.0.1, 비어 있는 포트). Jira 는 부르지 않는다.
// 서버는 셋이다: A·C 는 허용 목록에 있고 B 는 없다.

type Handler = (request: IncomingMessage, response: ServerResponse, body: Buffer) => void

interface Fake {
  origin: string
  hits: string[]
  route: Map<string, Handler>
  server: Server
}

let a: Fake
let b: Fake
let c: Fake

async function fake(): Promise<Fake> {
  const hits: string[] = []
  const route = new Map<string, Handler>()
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      hits.push(request.url ?? '')
      const handler = route.get(request.url ?? '')
      if (handler) handler(request, response, Buffer.concat(chunks))
      else response.writeHead(404).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits, route, server }
}

beforeEach(async () => {
  ;[a, b, c] = [await fake(), await fake(), await fake()]
})

afterEach(async () => {
  for (const one of [a, b, c]) {
    one.server.closeAllConnections()
    await new Promise((resolve) => one.server.close(resolve))
  }
})

/** 확장 `jira` 의 호출. 매니페스트·켜짐·겉봉은 고를 수 있다 */
function fetchAs(options: { network?: string[]; version?: number; allowed?: string[]; envelope?: string | null } = {}) {
  const deps = portsOf(
    { workspace: new ExtensionWorkspace(() => null) },
    {
      projectId: () => (options.envelope === undefined ? 'P' : options.envelope),
      allowedIn: async () => options.allowed ?? ['jira'],
      manifestOf: async (name) =>
        name === 'jira' ? { manifestVersion: options.version ?? 3, network: options.network ?? [a.origin, c.origin] } : undefined,
      emitRows: () => {},
      emitHtml: () => {},
      emitTree: () => {},
      emitProgress: () => {},
      notifyChild: () => {},
    },
  )
  return (params: Record<string, unknown>) =>
    dispatchExtensionApi(deps, createRequest(METHOD_HTTP_FETCH, { extension: 'jira', ...params })) as Promise<
      Record<string, unknown>
    >
}

const json = (value: unknown): Handler => (_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(value))
}

describe('허용 목록', () => {
  it('network 에 적은 출처는 닿는다 — 상태·머리·글 본문이 온다', async () => {
    a.route.set('/rest/api/2/search', json({ total: 5 }))

    const answer = await fetchAs()({ url: `${a.origin}/rest/api/2/search`, headers: { accept: 'application/json' } })

    expect(answer['status']).toBe(200)
    expect((answer['headers'] as Record<string, string>)['content-type']).toMatch(/application\/json/)
    expect(JSON.parse(answer['body'] as string)).toEqual({ total: 5 })
  })

  it('network 에 없는 출처는 거절하고 **서버에 닿지도 않는다**', async () => {
    b.route.set('/', json({}))

    await expect(fetchAs()({ url: `${b.origin}/` })).rejects.toThrow(/network 에 없는 출처/)
    expect(b.hits).toEqual([])
  })

  it('출처는 정확히 맞아야 한다 — 같은 호스트의 다른 포트는 다른 출처다', async () => {
    // a 와 b 는 둘 다 127.0.0.1 이고 포트만 다르다
    await expect(fetchAs({ network: [a.origin] })({ url: `${b.origin}/` })).rejects.toThrow(/network 에 없는 출처/)
  })

  it('2판(network 없음)은 어디에도 못 닿는다', async () => {
    a.route.set('/', json({}))
    await expect(fetchAs({ version: 2, network: [] })({ url: `${a.origin}/` })).rejects.toThrow(/network 에 없는 출처/)
    expect(a.hits).toEqual([])
  })

  it('그 프로젝트에서 켜지 않은 확장이면 거절한다 — ui.post·ai.run 과 같은 규칙', async () => {
    a.route.set('/', json({}))
    await expect(fetchAs({ allowed: ['other'] })({ url: `${a.origin}/` })).rejects.toThrow(/켜지 않은 확장/)
    expect(a.hits).toEqual([])
  })

  it('겉봉도 projectId 도 없으면 거절한다', async () => {
    await expect(fetchAs({ envelope: null })({ url: `${a.origin}/` })).rejects.toThrow(/어느 프로젝트/)
  })
})

describe('넘겨주기', () => {
  it('행선지가 허용 목록 밖이면 따라가지 않고 거절한다', async () => {
    a.route.set('/go', (_q, response) => response.writeHead(302, { location: `${b.origin}/steal` }).end())
    b.route.set('/steal', json({}))

    await expect(fetchAs()({ url: `${a.origin}/go` })).rejects.toThrow(/넘겨주기 행선지가 network 에 없는 출처/)
    expect(b.hits).toEqual([])
  })

  it('행선지가 허용 목록 안이면 따라간다', async () => {
    a.route.set('/go', (_q, response) => response.writeHead(302, { location: '/there' }).end())
    a.route.set('/there', json({ arrived: true }))

    expect(JSON.parse((await fetchAs()({ url: `${a.origin}/go` }))['body'] as string)).toEqual({ arrived: true })
  })

  it('출처가 바뀌면 authorization 을 떼어 낸다 — 같은 출처면 그대로 간다', async () => {
    const auth: Handler = (request, response) =>
      response.writeHead(200, { 'content-type': 'text/plain' }).end(request.headers.authorization ?? 'none')
    a.route.set('/same', (_q, response) => response.writeHead(307, { location: '/auth' }).end())
    a.route.set('/cross', (_q, response) => response.writeHead(307, { location: `${c.origin}/auth` }).end())
    a.route.set('/auth', auth)
    c.route.set('/auth', auth)
    const call = fetchAs()
    const headers = { authorization: 'Bearer token' }

    expect((await call({ url: `${a.origin}/same`, headers }))['body']).toBe('Bearer token')
    expect((await call({ url: `${a.origin}/cross`, headers }))['body']).toBe('none')
  })
})

describe('상한', () => {
  it('응답이 10MB 를 넘으면 거절한다 — 길이를 안 밝혀도 받는 대로 센다', async () => {
    a.route.set('/big', (_q, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      const chunk = Buffer.alloc(1024 * 1024)
      for (let sent = 0; sent <= HTTP_MAX_RESPONSE_BYTES; sent += chunk.length) response.write(chunk)
      response.end()
    })

    await expect(fetchAs()({ url: `${a.origin}/big` })).rejects.toThrow(/10MB 를 넘었습니다/)
  })

  it('시간을 넘기면 거절한다', async () => {
    a.route.set('/hang', () => {}) // 답하지 않는다

    await expect(fetchAs()({ url: `${a.origin}/hang`, timeoutMs: 150 })).rejects.toThrow(/시간 초과 \(150ms\)/)
  })

  it.each([0, -1, 120_001, '30000'])('timeoutMs %s 는 받지 않는다 (최대 120초)', async (timeoutMs) => {
    await expect(fetchAs()({ url: `${a.origin}/`, timeoutMs })).rejects.toThrow(/timeoutMs/)
    expect(a.hits).toEqual([])
  })
})

describe('본문', () => {
  it('바이트는 base64 로 왕복한다 — 첨부 올리기가 깨지지 않는다', async () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
    let received: Buffer = Buffer.alloc(0)
    a.route.set('/echo', (_q, response, body) => {
      received = body
      response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(body)
    })

    const answer = await fetchAs()({ url: `${a.origin}/echo`, method: 'POST', bodyBase64: bytes.toString('base64') })

    expect(received.equals(bytes)).toBe(true)
    expect(answer['body']).toBeUndefined()
    expect(Buffer.from(answer['bodyBase64'] as string, 'base64').equals(bytes)).toBe(true)
  })

  it.each([
    [{ body: 'x', bodyBase64: 'eA==' }, /하나만/],
    [{ bodyBase64: '!!!!' }, /base64 가 아닙니다/],
  ])('본문 모양이 틀리면 부르지 않는다 %#', async (init, reason) => {
    await expect(fetchAs()({ url: `${a.origin}/`, method: 'POST', ...init })).rejects.toThrow(reason)
    expect(a.hits).toEqual([])
  })

  it('쿠키를 담아 두지 않는다 — 받은 쿠키가 다음 요청에 안 실린다', async () => {
    a.route.set('/login', (_q, response) => response.writeHead(200, { 'set-cookie': 'JSESSIONID=abc' }).end())
    a.route.set('/who', (request, response) =>
      response.writeHead(200, { 'content-type': 'text/plain' }).end(request.headers.cookie ?? 'none'),
    )
    const call = fetchAs()

    await call({ url: `${a.origin}/login` })
    expect((await call({ url: `${a.origin}/who` }))['body']).toBe('none')
  })
})
