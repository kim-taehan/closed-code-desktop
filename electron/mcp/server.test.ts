import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpServer } from './server'

// 실제로 포트를 열어 확인한다 — 토큰·경로·프로젝트 신원은 전부 HTTP 층에 걸려 있어서
// 함수만 불러서는 지켜지는지 알 수 없다.
//
// 공여(develop-desktop/electron/mcp/server.test.ts) 이식 + 프로젝트 신원 케이스 둘 추가.

describe('McpServer', () => {
  let server: McpServer | null = null

  afterEach(async () => {
    await server?.stop()
    server = null
  })

  const start = async (
    run = vi.fn().mockResolvedValue('열었습니다'),
  ): Promise<{ url: (path: string) => string; token: string; run: typeof run }> => {
    server = new McpServer(run)
    await server.start()
    const address = server.address()
    if (address === null) throw new Error('서버가 뜨지 않았다')
    return {
      url: (path) => `http://127.0.0.1:${address.port}${path}`,
      token: address.token,
      run,
    }
  }

  const call = (name: string): string =>
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { path: 'a.ts' } } })

  it('토큰이 없으면 401 이다', async () => {
    const { url } = await start()
    const response = await fetch(url('/mcp/proj-1'), { method: 'POST', body: call('open_file') })
    expect(response.status).toBe(401)
  })

  it('틀린 토큰도 401 이다', async () => {
    const { url } = await start()
    const response = await fetch(url('/mcp/proj-1'), {
      method: 'POST',
      headers: { Authorization: 'Bearer not-the-token' },
      body: call('open_file'),
    })
    expect(response.status).toBe(401)
  })

  // 프로젝트 신원이 주소에서 오지 않으면 A 프로젝트의 에이전트가 B 를 열 수 있다
  it('URL 의 프로젝트 id 로 도구를 부른다', async () => {
    const { url, token, run } = await start()
    const response = await fetch(url('/mcp/proj-1'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: call('open_file'),
    })

    expect(response.status).toBe(200)
    expect(run).toHaveBeenCalledWith('proj-1', 'open_file', { path: 'a.ts' })
    const body = (await response.json()) as { result: { content: { text: string }[] } }
    expect(body.result.content[0]?.text).toBe('열었습니다')
  })

  // **A 의 토큰으로 B 를 조작할 수 없다** — 토큰은 앱 단위라 그것만으로는 못 가른다.
  // 가르는 것은 URL 경로이고, 그 값이 그대로 도구 실행에 실려야 한다.
  it('B 주소로 부르면 도구가 B 로 실행된다 (A 것이 새지 않는다)', async () => {
    const { url, token, run } = await start()
    await fetch(url('/mcp/proj-B'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: call('open_file'),
    })
    expect(run).toHaveBeenCalledWith('proj-B', 'open_file', { path: 'a.ts' })
    expect(run).not.toHaveBeenCalledWith('proj-1', expect.anything(), expect.anything())
  })

  // 경로에 인코딩된 문자가 있어도 원래 신원으로 되돌아와야 한다 (등록할 때 encodeURIComponent 를 탄다)
  it('인코딩된 프로젝트 id 를 풀어서 넘긴다', async () => {
    const { url, token, run } = await start()
    await fetch(url(`/mcp/${encodeURIComponent('proj/1 2')}`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: call('current_view'),
    })
    expect(run).toHaveBeenCalledWith('proj/1 2', 'current_view', { path: 'a.ts' })
  })

  it('프로젝트 없는 주소는 404 다', async () => {
    const { url, token } = await start()
    const response = await fetch(url('/mcp/'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: call('open_file'),
    })
    expect(response.status).toBe(404)
  })

  // opencode 는 붙자마자 SSE 를 얻으려 GET 을 한 번 시도한다 (1.17.18 실측).
  // 405 를 돌려줘도 연결은 connected 로 끝난다 — 스트림을 만들 필요가 없다.
  it('POST 가 아니면 405 다', async () => {
    const { url, token } = await start()
    const response = await fetch(url('/mcp/proj-1'), {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(405)
  })

  it('알림에는 본문 없이 202 로 답한다', async () => {
    const { url, token } = await start()
    const response = await fetch(url('/mcp/proj-1'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })
    expect(response.status).toBe(202)
  })

  it('본문이 상한을 넘으면 413 이다', async () => {
    const { url, token } = await start()
    const response = await fetch(url('/mcp/proj-1'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: 'x'.repeat(64 * 1024 + 1),
    })
    expect(response.status).toBe(413)
  })

  it('끄면 그 포트로 더 닿지 않는다', async () => {
    const { url, token } = await start()
    await server?.stop()
    await expect(
      fetch(url('/mcp/proj-1'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: call('open_file'),
      }),
    ).rejects.toThrow()
  })

  it('두 번 켜도 주소는 하나다', async () => {
    await start()
    const first = server?.address()
    await server?.start()
    expect(server?.address()).toEqual(first)
  })
})
