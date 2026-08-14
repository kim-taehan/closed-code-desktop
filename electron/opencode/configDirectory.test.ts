import { describe, expect, it, vi } from 'vitest'
import { OpencodeClient } from './client'
import { fakeServer, makeTransport, tick } from './transportTestKit'

// 이 파일이 겨누는 것은 **설정 조회에 프로젝트 신원이 실리는가** 하나다.
//
// `/config` 와 `/config/providers` 는 `?directory=` 가 있어야 그 프로젝트의 `opencode.json` 을
// 읽는다 (2026-08-14 실측). 같은 서버 하나에서 답이 갈린다:
//
//   /config 의 model         전역 `davis-litellm/glm-5.2`  ↔  projX `projonly/only-here`
//   /config/providers        전역 3개                      ↔  projX 4개
//
// **응답이 아니라 요청 URL 문자열 자체를 단언한다.** 질의 이름을 틀려도 opencode 는 그것을
// 무시하고 **HTTP 200 에 전역 설정**을 준다 — `register.test.ts` 가 MCP 표면에서 겪은 것과 같은
// 모양이고(`location[directory]=` 를 200 으로 받아 서버 cwd 에 등록), 증상은 한참 뒤
// "프로젝트가 정한 모델을 desktop 이 무시한다" 로만 나타난다. 응답만 보는 테스트는 초록인 채로
// 전역을 읽고 있을 수 있다.

function fakeFetch(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch
}

function urlOf(impl: typeof fetch, index = 0): string {
  const calls = (impl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
  return String(calls[index]![0])
}

describe('OpencodeClient 설정 조회', () => {
  it('providers 는 /config/providers?directory= 로 간다', async () => {
    const impl = fakeFetch({ providers: [] })
    const client = new OpencodeClient({ baseUrl: 'http://127.0.0.1:4096', fetchImpl: impl })
    await client.providers('/Users/me/projX')

    expect(urlOf(impl)).toBe(
      `http://127.0.0.1:4096/config/providers?directory=${encodeURIComponent('/Users/me/projX')}`,
    )
    // pty 표면의 이름(`location[directory]=`)으로 새면 200 인 채로 전역이 온다
    expect(urlOf(impl)).not.toContain('location')
    // `/api` 판은 없다 — 그 주소는 404 가 아니라 웹 UI HTML 을 준다 (README 실측 함정 11)
    expect(urlOf(impl)).not.toContain('/api/config')
  })

  it('config 는 /config?directory= 로 간다', async () => {
    const impl = fakeFetch({ model: 'projonly/only-here' })
    const client = new OpencodeClient({ baseUrl: 'http://127.0.0.1:4096', fetchImpl: impl })
    const config = await client.config('/Users/me/projX')

    expect(urlOf(impl)).toBe(
      `http://127.0.0.1:4096/config?directory=${encodeURIComponent('/Users/me/projX')}`,
    )
    expect(config.model).toBe('projonly/only-here')
  })

  it('공백·한글 경로도 질의로 안전하게 실린다', async () => {
    const impl = fakeFetch({ model: 'x/y' })
    const client = new OpencodeClient({ baseUrl: 'http://127.0.0.1:4096', fetchImpl: impl })
    await client.config('/Users/me/내 프로젝트')

    expect(urlOf(impl)).toBe(
      `http://127.0.0.1:4096/config?directory=${encodeURIComponent('/Users/me/내 프로젝트')}`,
    )
  })

  // 디렉토리를 모르는 때(세션 전)에 빈 질의를 붙이면 서버가 빈 문자열을 디렉토리로 해석할 수
  // 있다 — 안 붙이는 쪽이 "전역을 달라" 는 뜻으로 명확하다.
  it('디렉토리가 없으면 질의를 아예 붙이지 않는다', async () => {
    const impl = fakeFetch({ providers: [] })
    const client = new OpencodeClient({ baseUrl: 'http://127.0.0.1:4096', fetchImpl: impl })
    await client.providers(null)

    expect(urlOf(impl)).toBe('http://127.0.0.1:4096/config/providers')
  })
})

// 어댑터가 워크스페이스를 아는 자리는 `workspace_sync` 하나다 (세션 생성 직전).
// 위층(session/*)을 넓히지 않고 그 값을 설정 조회까지 흘려보내는지 끝에서 끝까지 본다.
describe('워크스페이스에서 설정 조회까지', () => {
  it('workspace_sync 로 받은 디렉토리가 llm_config_status 의 설정 조회에 실린다', async () => {
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
        data: { workspace: { workspacePath: '/tmp/proj' } },
      }),
    )
    await tick()

    transport.send(
      JSON.stringify({ kind: 'llm_config', action: 'llm_config_status', reqId: 'r2', data: {} }),
    )
    await tick()

    const query = `?directory=${encodeURIComponent('/tmp/proj')}`
    expect(server.find((call) => call.url.startsWith('http://127.0.0.1:4096/config' + query))?.url).toBe(
      `http://127.0.0.1:4096/config${query}`,
    )
    expect(server.find((call) => call.url.includes('/config/providers'))?.url).toBe(
      `http://127.0.0.1:4096/config/providers${query}`,
    )
    transport.close()
  })
})
