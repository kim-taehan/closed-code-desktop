import { afterEach, describe, expect, it, vi } from 'vitest'
import { remoteMcpTools } from './remoteMcpTools'

// 원격 MCP 서버에 도구 목록을 묻는 길.
//
// 아래 응답은 **손으로 지어낸 것이 아니다** — davis-cloud-mcp(`https://<internal-mcp-host>/mcp`,
// 2026-08-24)에 직접 물어 받은 원문의 모양이다. 줄바꿈이 `\r\n` 인 것, 성공은 SSE 이고
// 오류는 그냥 JSON 인 것, 세션이 몸통이 아니라 헤더로 오는 것까지 그대로 옮겼다.
//
// 잠그는 것: 세 왕복의 순서와 헤더(둘 중 하나만 틀려도 실물은 400·406 을 준다).
// 찾는 것: **실패가 화면으로 새는 것** — 이 호출은 다이얼로그가 열리는 길목에 있어서
// 던지는 순간 커넥터 화면이 통째로 막힌다.

const TOOLS_SSE =
  'event: message\r\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[' +
  '{"name":"health_check","description":"서비스 상태를 확인한다."},' +
  '{"name":"prom_execute_query","description":"PromQL 을 실행한다.","inputSchema":{"type":"object"}}' +
  ']}}\r\n\r\n'

/** 세션을 헤더로 주는 정상 서버. 호출을 순서대로 기록한다. */
function fakeServer(overrides: { session?: string | null; toolsBody?: string } = {}) {
  const calls: { method: string; session: string | null; accept: string }[] = []
  const session = overrides.session === undefined ? 'sid-1' : overrides.session
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    calls.push({
      method: JSON.parse(init.body as string).method,
      session: headers['mcp-session-id'] ?? null,
      accept: headers['Accept'] ?? '',
    })
    if (calls.length === 1) {
      return {
        headers: { get: () => session },
        text: async () => 'event: message\r\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\r\n\r\n',
      } as unknown as Response
    }
    return {
      headers: { get: () => null },
      text: async () => overrides.toolsBody ?? TOOLS_SSE,
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchImpl)
  return { calls, fetchImpl }
}

afterEach(() => vi.unstubAllGlobals())

describe('도구 목록을 받아 온다', () => {
  it('이름과 설명을 뽑는다', async () => {
    fakeServer()
    expect(await remoteMcpTools('http://mcp.test/mcp')).toEqual([
      { name: 'health_check', description: '서비스 상태를 확인한다.' },
      { name: 'prom_execute_query', description: 'PromQL 을 실행한다.' },
    ])
  })

  // 지금 화면이 인자를 그릴 자리가 없고, 이 서버들의 스키마는 설명보다 훨씬 크다
  it('inputSchema 는 싣지 않는다 — 봉투만 부푼다', async () => {
    fakeServer()
    const tools = await remoteMcpTools('http://mcp.test/mcp')
    expect(tools.every((tool) => !('inputSchema' in tool))).toBe(true)
  })

  it('initialize → initialized → tools/list 를 그 순서로 왕복한다', async () => {
    const { calls } = fakeServer()
    await remoteMcpTools('http://mcp.test/mcp')
    expect(calls.map((call) => call.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ])
  })

  // 실물은 세션 없이 부르면 400 `Missing session ID` 다. 첫 호출에는 아직 세션이 없다
  it('세션은 첫 응답 헤더에서 받아 뒤 호출에 싣는다', async () => {
    const { calls } = fakeServer()
    await remoteMcpTools('http://mcp.test/mcp')
    expect(calls.map((call) => call.session)).toEqual([null, 'sid-1', 'sid-1'])
  })

  // 하나만 보내면 실물이 406 이다 ("Client must accept both …")
  it('Accept 로 json 과 event-stream 을 둘 다 받는다', async () => {
    const { calls } = fakeServer()
    await remoteMcpTools('http://mcp.test/mcp')
    expect(calls.every((call) => call.accept.includes('application/json'))).toBe(true)
    expect(calls.every((call) => call.accept.includes('text/event-stream'))).toBe(true)
  })

  // 규약은 SSE 를 요구하지 않는다 — `application/json` 으로 답하는 서버도 읽어야 한다
  it('SSE 가 아니라 그냥 JSON 으로 와도 읽는다', async () => {
    fakeServer({ toolsBody: '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"solo"}]}}' })
    expect(await remoteMcpTools('http://mcp.test/mcp')).toEqual([{ name: 'solo' }])
  })

  // MCP 규약상 설명은 선택이다. 빈 값을 지어 넣으면 화면이 「설명이 있는데 비었다」로 그린다
  it('설명이 없는 도구는 설명 없이 낸다', async () => {
    fakeServer({ toolsBody: '{"result":{"tools":[{"name":"solo"},{"description":"이름이 없다"}]}}' })
    expect(await remoteMcpTools('http://mcp.test/mcp')).toEqual([{ name: 'solo' }])
  })
})

// 이 호출은 커넥터 다이얼로그가 열리는 길목에 있다. 여기서 던지면 서버 하나가 느린 것 때문에
// 화면 전체가 막힌다 — `mcpConfig.ts` 가 connect 실패를 삼키는 것과 같은 규칙이다.
describe('실패는 빈손으로만 나온다', () => {
  it('세션을 안 주면 더 두드리지 않고 빈손이다', async () => {
    const { calls } = fakeServer({ session: null })
    expect(await remoteMcpTools('http://mcp.test/mcp')).toEqual([])
    // 세션 없이 부르면 어차피 400 이다. 알면서 두 번 더 두드리지 않는다
    expect(calls).toHaveLength(1)
  })

  it('서버가 오류 JSON 을 주면 빈손이다', async () => {
    fakeServer({
      toolsBody: '{"jsonrpc":"2.0","id":"server-error","error":{"code":-32600,"message":"Bad Request"}}',
    })
    expect(await remoteMcpTools('http://mcp.test/mcp')).toEqual([])
  })

  it('응답이 JSON 이 아니어도 던지지 않는다', async () => {
    fakeServer({ toolsBody: '<html>502 Bad Gateway</html>' })
    expect(await remoteMcpTools('http://mcp.test/mcp')).toEqual([])
  })

  it('연결이 끊기면 빈손이다', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED')
    })
    expect(await remoteMcpTools('http://mcp.test/mcp')).toEqual([])
  })

  // 죽은 줄 모르고 매달린 서버가 다이얼로그를 붙잡는 자리다
  it('시간을 넘기면 끊고 빈손이다', async () => {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })
    expect(await remoteMcpTools('http://mcp.test/mcp', 5)).toEqual([])
  })
})
