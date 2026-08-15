import { describe, expect, it, vi } from 'vitest'
import { Action, Kind } from '../../shared/protocol/kinds'
import { parseMcpState } from '../../shared/protocol/mcpConfig'
import { mcpConfigFrame } from './mcpConfig'

// 실측 페이로드(opencode 1.18.18, 2026-08-15) → davis `mcp_config` 봉투.
//
// 아래 상태 맵은 **손으로 지어낸 것이 아니다**. 빈 git 디렉터리에 remote 2 · local 2 를
// 심고 `GET /mcp?directory=` 로 받은 응답 그대로다 — 오류 문구까지 원문이다.

const STATUS = {
  deadremote: { status: 'failed', error: 'SSE error: Unable to connect. Is the computer able to access the url?' },
  offremote: { status: 'disabled' },
  deadlocal: { status: 'failed', error: 'MCP error -32000: Connection closed' },
  'open-code-desktop': { status: 'connected' },
}

// `GET /config?directory=` 의 `.mcp` 절. **우리 서버는 여기 없다** —
// 런타임 등록(`POST /mcp`)은 설정 파일에 안 써진다 (실측).
const CONFIG = {
  mcp: {
    deadremote: { type: 'remote', url: 'http://127.0.0.1:9/mcp', enabled: true },
    offremote: { type: 'remote', url: 'http://127.0.0.1:9999/mcp', enabled: false },
    deadlocal: { type: 'local', command: ['/usr/bin/false'] },
  },
}

function client(overrides: Partial<Record<'mcpStatus' | 'config' | 'setMcpEnabled', unknown>> = {}) {
  return {
    mcpStatus: vi.fn(async () => STATUS),
    config: vi.fn(async () => CONFIG),
    setMcpEnabled: vi.fn(async () => undefined),
    ...overrides,
  } as never
}

async function stateOf(api = client(), action: string = Action.MCP_CONFIG_STATUS, data = {}) {
  const frame = await mcpConfigFrame(api, '/proj', action, data)
  return parseMcpState((frame as { data: unknown }).data)
}

describe('mcpConfigFrame', () => {
  it('status 는 mcp_config 봉투로 답한다', async () => {
    const frame = await mcpConfigFrame(client(), '/proj', Action.MCP_CONFIG_STATUS, {})
    expect(frame?.['kind']).toBe(Kind.MCP_CONFIG)
    expect(frame?.['action']).toBe(Action.MCP_CONFIG_STATUS)
  })

  it('두 표면을 합쳐 상태·갈래·주소를 한 항목에 담는다', async () => {
    const state = await stateOf()
    expect(state.servers[0]).toEqual({
      serverName: 'deadremote',
      status: 'failed',
      transport: 'remote',
      url: 'http://127.0.0.1:9/mcp',
      error: 'SSE error: Unable to connect. Is the computer able to access the url?',
      tools: [],
    })
  })

  it('local 서버는 실행 명령을 주소 자리에 넣는다', async () => {
    const state = await stateOf()
    const local = state.servers.find((server) => server.serverName === 'deadlocal')
    expect(local).toMatchObject({ transport: 'local', url: '/usr/bin/false' })
  })

  it('꺼진 서버는 disabled 이고 오류가 없다', async () => {
    const off = (await stateOf()).servers.find((server) => server.serverName === 'offremote')
    expect(off?.status).toBe('disabled')
    expect(off?.error).toBeUndefined()
  })

  // 설정 쪽을 기준으로 돌면 우리 서버가 목록에서 통째로 빠진다 — 상태 맵이 기준인 이유다
  it('설정에 없는 우리 서버도 목록에 남고, 도구 목록이 그 표식이 된다', async () => {
    const ours = (await stateOf()).servers.find((s) => s.serverName === 'open-code-desktop')
    expect(ours?.status).toBe('connected')
    expect(ours?.transport).toBe('unknown')
    expect(ours?.tools).toEqual(['open_file', 'current_view'])
  })

  it('남의 서버 도구는 지어내지 않는다', async () => {
    expect((await stateOf()).servers.every((s) => s.serverName === 'open-code-desktop' || s.tools.length === 0)).toBe(true)
  })

  it('순서는 opencode 가 준 그대로다 — 이름순으로 고치지 않는다', async () => {
    expect((await stateOf()).servers.map((server) => server.serverName)).toEqual(Object.keys(STATUS))
  })

  it('set 은 connect 로 번역되고, 끝난 뒤 상태를 다시 읽는다', async () => {
    const api = client()
    await stateOf(api, Action.MCP_CONFIG_SET, { server_name: 'deadremote', enabled: true })
    expect((api as unknown as { setMcpEnabled: ReturnType<typeof vi.fn> }).setMcpEnabled)
      .toHaveBeenCalledWith('/proj', 'deadremote', true)
    // 불린을 믿지 않는다는 규칙이 여기 걸린다 — 켠 뒤에 반드시 다시 읽는다
    expect((api as unknown as { mcpStatus: ReturnType<typeof vi.fn> }).mcpStatus).toHaveBeenCalledTimes(1)
  })

  it('enabled:false 는 disconnect 다', async () => {
    const api = client()
    await stateOf(api, Action.MCP_CONFIG_SET, { server_name: 'offremote', enabled: false })
    expect((api as unknown as { setMcpEnabled: ReturnType<typeof vi.fn> }).setMcpEnabled)
      .toHaveBeenCalledWith('/proj', 'offremote', false)
  })

  it('connect 가 실패해도 목록은 낸다 — 서버 하나 때문에 화면을 덮지 않는다', async () => {
    const api = client({ setMcpEnabled: vi.fn(async () => { throw new Error('404') }) })
    const state = await stateOf(api, Action.MCP_CONFIG_SET, { server_name: 'deadremote', enabled: true })
    expect(state.servers).toHaveLength(4)
  })

  it('설정 조회가 실패해도 상태만으로 목록을 낸다', async () => {
    const api = client({ config: vi.fn(async () => { throw new Error('down') }) })
    const state = await stateOf(api)
    expect(state.servers).toHaveLength(4)
    expect(state.servers[0]).toMatchObject({ transport: 'unknown' })
    expect(state.servers[0]?.url).toBeUndefined()
  })

  it('상태 조회가 실패하면 사유를 message 로 올린다', async () => {
    const api = client({ mcpStatus: vi.fn(async () => { throw new Error('HTTP 500') }) })
    const state = await stateOf(api)
    expect(state.servers).toEqual([])
    expect(state.message).toContain('HTTP 500')
  })

  it('mcp_config_test 는 답하지 않는다 — opencode 에 대응 표면이 없다', async () => {
    expect(await mcpConfigFrame(client(), '/proj', Action.MCP_CONFIG_TEST, {})).toBeNull()
  })
})
