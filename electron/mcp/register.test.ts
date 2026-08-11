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
    const status = await registerMcpServer({
      opencodeUrl: 'http://127.0.0.1:4096',
      directory: '/Users/me/projA',
      projectId: 'proj-1',
      address,
      fetchImpl: impl,
    })

    const { url, body } = callOf(impl)
    // `/api/mcp` 는 없다 (1.17.18 `/doc` 전수 확인) — 이 한 건만 레거시 표면이다
    expect(url).toBe(`http://127.0.0.1:4096/mcp?directory=${encodeURIComponent('/Users/me/projA')}`)
    expect(body['name']).toBe(SERVER_NAME)
    expect(body['config']).toEqual({
      // ⚠️ `http` 가 아니라 `remote` 다 — 공여가 claude 에 넘기던 모양과 이름만 다르다
      type: 'remote',
      url: `http://127.0.0.1:45678/mcp/proj-1`,
      headers: { Authorization: 'Bearer tok-1' },
      enabled: true,
    })
    expect(status).toBe('connected')
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

  // 우리 서버가 안 떠 있으면 opencode 는 실패가 아니라 `disabled` 로 답한다 (실측).
  // 부르는 쪽이 이걸 보고 다시 시도할 수 있어야 한다.
  it('붙지 못하면 그 상태를 그대로 돌려준다', async () => {
    const impl = fakeFetch({ [SERVER_NAME]: { status: 'disabled' } })
    const status = await registerMcpServer({
      opencodeUrl: 'http://127.0.0.1:4096',
      directory: '/Users/me/projA',
      projectId: 'proj-1',
      address,
      fetchImpl: impl,
    })
    expect(status).toBe('disabled')
  })

  it('우리 이름이 응답에 없으면 unknown 이다', async () => {
    const impl = fakeFetch({})
    const status = await registerMcpServer({
      opencodeUrl: 'http://127.0.0.1:4096',
      directory: '/Users/me/projA',
      projectId: 'proj-1',
      address,
      fetchImpl: impl,
    })
    expect(status).toBe('unknown')
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
