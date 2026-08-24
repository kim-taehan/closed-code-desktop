import { afterEach, describe, expect, it, vi } from 'vitest'
import { Action, Kind } from '../../shared/protocol/kinds'
import { parseMcpState } from '../../shared/protocol/mcpConfig'
import { mcpConfigFrame } from './mcpConfig'

// 실측 페이로드(opencode 1.18.18, 2026-08-15) → davis `mcp_config` 봉투.
//
// 아래 상태 맵은 **손으로 지어낸 것이 아니다**. 빈 git 디렉터리에 remote·local 을 심고
// `GET /mcp?directory=` 로 받은 응답 그대로다 — 오류 문구까지 원문이다.
// `divergent` 는 contract-qa 가 자기 하네스에서 만들어 낸 상태를 옮긴 것이다 (그 항목 주석).

const STATUS = {
  deadremote: { status: 'failed', error: 'SSE error: Unable to connect. Is the computer able to access the url?' },
  offremote: { status: 'disabled' },
  deadlocal: { status: 'failed', error: 'MCP error -32000: Connection closed' },
  // **설정과 런타임이 갈라진 항목.** `enabled:false` 인데 상태는 `failed` 다 — 꺼진 서버에
  // connect 를 부르고 disconnect 를 안 하면 이 모양으로 **남는다** (contract-qa 실측).
  // 다른 항목은 둘이 일치해서, 이것이 없으면 「꺼짐」의 근거를 `enabled` 로 바꿔도 전부 초록이다.
  divergent: { status: 'failed', error: 'MCP error -32000: Connection closed' },
  'closed-code-desktop': { status: 'connected' },
}

// `GET /config?directory=` 의 `.mcp` 절. **우리 서버는 여기 없다** —
// 런타임 등록(`POST /mcp`)은 설정 파일에 안 써진다 (실측).
const CONFIG = {
  mcp: {
    deadremote: { type: 'remote', url: 'http://127.0.0.1:9/mcp', enabled: true },
    offremote: { type: 'remote', url: 'http://127.0.0.1:9999/mcp', enabled: false },
    deadlocal: { type: 'local', command: ['/usr/bin/false'] },
    divergent: { type: 'remote', url: 'http://127.0.0.1:9997/mcp', enabled: false },
    // **설정에만 있고 상태 맵에는 없는 항목.** 스키마를 어긴 설정을 opencode 가 버리면
    // `/config` 에는 `type` 까지 떨어진 껍데기가 남고 `/mcp` 에는 아예 안 나타난다
    // (실측 — `mcpConfig.ts` 머리말 (b)). 합집합을 안 돌면 사용자 오타가 화면에서 사라진다.
    husk: { enabled: true },
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

  // 이 자리를 잠그는 것이 이 파일의 목적 하나다 — 「꺼짐」의 근거는 런타임 status 하나이고
  // 설정의 `enabled` 는 **경계를 넘지 않는다**. 근거와 사유는 `mcpConfig.ts` 의 `toServer` 주석.
  it('설정은 꺼져 있는데 런타임이 실패면 실패다 — enabled 를 근거로 삼지 않는다', async () => {
    const split = (await stateOf()).servers.find((server) => server.serverName === 'divergent')
    expect(split?.status).toBe('failed')
    expect(split?.error).toBe('MCP error -32000: Connection closed')
  })

  it('enabled 는 봉투에 실리지 않는다 — 진실의 출처를 둘로 만들지 않는다', async () => {
    const frame = await mcpConfigFrame(client(), '/proj', Action.MCP_CONFIG_STATUS, {})
    const servers = (frame?.['data'] as { servers: Record<string, unknown>[] }).servers
    expect(servers.every((server) => !('enabled' in server))).toBe(true)
  })

  // 설정 쪽을 기준으로 돌면 우리 서버가 목록에서 통째로 빠진다 — 상태 맵이 기준인 이유다
  it('설정에 없는 우리 서버도 목록에 남고, 도구 목록이 그 표식이 된다', async () => {
    const ours = (await stateOf()).servers.find((s) => s.serverName === 'closed-code-desktop')
    expect(ours?.status).toBe('connected')
    expect(ours?.transport).toBe('unknown')
    expect(ours?.tools.map((tool) => tool.name)).toEqual([
      'open_file',
      'open_terminal',
      'run_project',
      'read_logs',
      'save_run_commands',
    ])
  })

  // 설명은 `toolSchemas.ts` 에 처음부터 도구마다 적혀 있었는데, 여기서 이름만 뽑느라
  // 떨어뜨리고 있었다 — 화면에는 이름표만 남아 무엇을 하는 도구인지 알 길이 없었다.
  it('도구 설명을 함께 싣는다 — 이름만 보내던 자리다', async () => {
    const ours = (await stateOf()).servers.find((s) => s.serverName === 'closed-code-desktop')
    expect(ours?.tools.every((tool) => (tool.description ?? '') !== '')).toBe(true)
  })

  it('남의 서버 도구는 지어내지 않는다', async () => {
    expect((await stateOf()).servers.every((s) => s.serverName === 'closed-code-desktop' || s.tools.length === 0)).toBe(true)
  })

  it('순서는 opencode 가 준 그대로다 — 이름순으로 고치지 않는다', async () => {
    const names = (await stateOf()).servers.map((server) => server.serverName)
    // 상태 맵이 먼저, 설정에만 있는 것이 뒤
    expect(names).toEqual([...Object.keys(STATUS), 'husk'])
  })

  // opencode 가 버린 설정 항목이 화면에서 통째로 사라지던 자리. 사용자 오타가 조용히 죽는다
  it('설정에만 있는 이름도 목록에 남는다 — status 는 unknown 이다', async () => {
    const husk = (await stateOf()).servers.find((server) => server.serverName === 'husk')
    expect(husk).toBeDefined()
    expect(husk?.status).toBe('unknown')
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
    expect(state.servers).toHaveLength(6)
  })

  it('설정 조회가 실패해도 상태만으로 목록을 낸다', async () => {
    const api = client({ config: vi.fn(async () => { throw new Error('down') }) })
    const state = await stateOf(api)
    expect(state.servers).toHaveLength(5)
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

// **두 층 사이의 배선.** 무는 길(`remoteMcpTools.ts`)과 봉투 만들기는 각자 잠겨 있어도,
// **누구에게 묻는지를 고르는 규칙**은 여기 말고 잠길 자리가 없다. 그 규칙이 곧 다이얼로그가
// 뜨는 속도이기도 하다 — 죽은 서버까지 두드리면 그 시간만큼 화면이 늦는다.
describe('원격 서버 도구를 물어서 채운다', () => {
  const LIVE = {
    'davis-cloud-mcp': { status: 'connected' },
    deadremote: { status: 'failed', error: 'SSE error: Unable to connect.' },
    livelocal: { status: 'connected' },
    'closed-code-desktop': { status: 'connected' },
  }
  const LIVE_CONFIG = {
    mcp: {
      'davis-cloud-mcp': { type: 'remote', url: 'https://mcp.test/mcp' },
      deadremote: { type: 'remote', url: 'http://127.0.0.1:9/mcp' },
      livelocal: { type: 'local', command: ['/usr/bin/true'] },
    },
  }

  // 실물 응답의 모양 그대로 (`remoteMcpTools.test.ts` 머리말). 여기서는 누가 물었는지만 센다
  function probe() {
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const { method } = JSON.parse(init.body as string)
      if (method === 'initialize') asked.push(url)
      return {
        headers: { get: () => 'sid-1' },
        text: async () =>
          'event: message\r\ndata: {"result":{"tools":[{"name":"health_check","description":"상태를 본다."}]}}\r\n\r\n',
      } as unknown as Response
    })
    return asked
  }

  const live = () => client({ mcpStatus: vi.fn(async () => LIVE), config: vi.fn(async () => LIVE_CONFIG) })

  afterEach(() => vi.unstubAllGlobals())

  it('연결된 원격 서버는 도구가 찬다 — opencode 는 이걸 안 준다', async () => {
    probe()
    const cloud = (await stateOf(live())).servers.find((s) => s.serverName === 'davis-cloud-mcp')
    expect(cloud?.tools).toEqual([{ name: 'health_check', description: '상태를 본다.' }])
  })

  it('묻는 곳은 설정에 적힌 그 주소다', async () => {
    const asked = probe()
    await stateOf(live())
    expect(asked).toEqual(['https://mcp.test/mcp'])
  })

  // 죽은 서버는 답할 리 없고, 두드리는 시간만큼 다이얼로그가 늦게 뜬다
  it('실패한 원격은 두드리지 않는다', async () => {
    const asked = probe()
    const dead = (await stateOf(live())).servers.find((s) => s.serverName === 'deadremote')
    expect(asked).not.toContain('http://127.0.0.1:9/mcp')
    expect(dead?.tools).toEqual([])
  })

  // local 은 stdio 로 붙는다 — 주소 자리에 있는 것은 실행 명령이라 물을 곳이 아니다
  it('local 서버는 붙어 있어도 두드리지 않는다', async () => {
    const asked = probe()
    const local = (await stateOf(live())).servers.find((s) => s.serverName === 'livelocal')
    expect(asked).toHaveLength(1)
    expect(local?.tools).toEqual([])
  })

  it('우리 서버 도구는 원격 응답으로 덮이지 않는다', async () => {
    probe()
    const ours = (await stateOf(live())).servers.find((s) => s.serverName === 'closed-code-desktop')
    expect(ours?.tools.map((tool) => tool.name)).toContain('open_file')
  })

  // 서버 하나가 안 답하는 것과 목록을 못 받는 것은 다르다
  it('물었는데 못 받으면 그 칸만 비고 목록은 그대로다', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED')
    })
    const state = await stateOf(live())
    expect(state.servers).toHaveLength(4)
    expect(state.servers.find((s) => s.serverName === 'davis-cloud-mcp')?.tools).toEqual([])
    expect(state.message).toBe('')
  })
})
