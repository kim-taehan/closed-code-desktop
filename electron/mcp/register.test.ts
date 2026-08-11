import { describe, expect, it, vi } from 'vitest'
import { mcpUrlOf, registerMcpServer } from './register'
import { SERVER_NAME } from './rpc'

// 이 파일이 겨누는 것은 **신원이 두 겹 다 실리는가** 하나다.
//   1. opencode 쪽 `?directory=` — 빠지면 서버가 process.cwd() 로 떨어져 엉뚱한 곳에 등록된다
//   2. 우리 쪽 URL 경로 `/mcp/<projectId>` — 빠지면 요청만 보고 주인을 알 수 없다

const address = { port: 45678, token: 'tok-1' }

function fakeFetch(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof fetch
}

function callOf(impl: typeof fetch): { url: string; body: Record<string, unknown> } {
  const [url, init] = (impl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
  return { url, body: JSON.parse(String(init.body)) as Record<string, unknown> }
}

describe('registerMcpServer', () => {
  it('디렉토리를 질의로 싣고 우리 주소를 config 에 담는다', async () => {
    const impl = fakeFetch({ [SERVER_NAME]: { status: 'connected' } })
    const result = await registerMcpServer({
      opencodeUrl: 'http://127.0.0.1:4096',
      directory: '/Users/me/projA',
      projectId: 'proj-1',
      address,
      fetchImpl: impl,
    })

    const { url, body } = callOf(impl)
    // **URL 문자열 자체를 단언한다.** 응답 코드로는 못 잡는다 — `location[directory]=`(pty 표면
    // 이름)를 잘못 써도 opencode 는 HTTP 200 에 `connected` 를 준다. 그러고는 서버 cwd 쪽에
    // 등록돼 있어, 증상이 "로그는 connected 인데 세션에 도구가 안 뜬다" 로만 나온다.
    // `/api/mcp` 는 없다 (1.17.18 `/doc` 전수 확인) — 이 한 건만 레거시 표면이다.
    expect(url).toBe(`http://127.0.0.1:4096/mcp?directory=${encodeURIComponent('/Users/me/projA')}`)
    expect(url).not.toContain('location')
    expect(body['name']).toBe(SERVER_NAME)
    expect(body['config']).toEqual({
      // ⚠️ `http` 가 아니라 `remote` 다 — 공여가 claude 에 넘기던 모양과 이름만 다르다
      type: 'remote',
      url: `http://127.0.0.1:45678/mcp/proj-1`,
      headers: { Authorization: 'Bearer tok-1' },
      enabled: true,
    })
    expect(result.status).toBe('connected')
  })

  it('디렉토리에 공백·한글이 있어도 질의로 안전하게 실린다', async () => {
    const impl = fakeFetch({ [SERVER_NAME]: { status: 'connected' } })
    await registerMcpServer({
      opencodeUrl: 'http://127.0.0.1:4096',
      directory: '/Users/me/내 프로젝트',
      projectId: 'proj-1',
      address,
      fetchImpl: impl,
    })
    expect(callOf(impl).url).toContain(encodeURIComponent('/Users/me/내 프로젝트'))
  })

  // 우리 서버가 안 떠 있으면 `failed` + `error` 가 온다 (실측).
  //
  // **`error` 를 함께 돌려준다.** 등록 실패는 화면에 아무 증상이 없다 — 도구가 그냥 안 뜬다.
  // 로그가 유일한 단서인데 상태만 남기면 방화벽·포트 충돌·주소 오타를 구별할 수 없다.
  it('붙지 못하면 상태와 사유를 함께 돌려준다', async () => {
    const impl = fakeFetch({
      [SERVER_NAME]: { status: 'failed', error: 'SSE error: Unable to connect.' },
    })
    const result = await registerMcpServer({
      opencodeUrl: 'http://127.0.0.1:4096',
      directory: '/Users/me/projA',
      projectId: 'proj-1',
      address,
      fetchImpl: impl,
    })
    expect(result).toEqual({ status: 'failed', error: 'SSE error: Unable to connect.' })
  })

  // **응답은 서버가 아는 MCP 전체 맵이다** (실측). 사용자가 따로 등록해 둔 서버가 함께 온다.
  // `Object.values(res)[0]` 로 읽으면 남의 서버 상태를 우리 것으로 착각한다 — 이 케이스가
  // 없으면 그 퇴화가 초록으로 통과한다.
  it('남의 서버가 섞인 맵에서 우리 것만 이름으로 골라낸다', async () => {
    const impl = fakeFetch({
      'somebody-elses-mcp': { status: 'failed', error: '남의 서버 사정' },
      [SERVER_NAME]: { status: 'connected' },
    })
    const result = await registerMcpServer({
      opencodeUrl: 'http://127.0.0.1:4096',
      directory: '/Users/me/projA',
      projectId: 'proj-1',
      address,
      fetchImpl: impl,
    })
    expect(result).toEqual({ status: 'connected' })
  })

  it('우리 이름이 응답에 없으면 unknown 이다', async () => {
    const impl = fakeFetch({})
    const result = await registerMcpServer({
      opencodeUrl: 'http://127.0.0.1:4096',
      directory: '/Users/me/projA',
      projectId: 'proj-1',
      address,
      fetchImpl: impl,
    })
    expect(result.status).toBe('unknown')
  })
})

describe('mcpUrlOf', () => {
  // 127.0.0.1 로만 연다 — 다른 기계에서 못 닿아야 한다 (`server.ts` 의 바인딩과 짝이다)
  it('루프백 주소에 프로젝트 신원을 붙인다', () => {
    expect(mcpUrlOf(address, 'proj-1')).toBe('http://127.0.0.1:45678/mcp/proj-1')
  })

  it('프로젝트 신원에 특수문자가 있어도 경로 한 조각으로 남는다', () => {
    expect(mcpUrlOf(address, 'a/b')).toBe('http://127.0.0.1:45678/mcp/a%2Fb')
  })
})
