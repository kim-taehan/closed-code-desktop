import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopMcp } from './desktopMcp'
import { SERVER_NAME } from './rpc'

// 등록 **시점**만 겨눈다. 무엇을 보내는가는 register.test.ts 가 본다.
//
// 가장 중요한 케이스는 **재연결 후 다시 등록하는가** 다. opencode 의 등록은 instance
// 수명이라(실측: `POST /instance/dispose` 뒤 `GET /mcp` 가 `{}`) 한 번 등록하고 끝내면
// 서버가 재기동된 뒤 도구가 조용히 사라진다 — 화면에는 아무 증상이 없다.

function fakeFetch(status = 'connected', error?: string): typeof fetch {
  const ours = error === undefined ? { status } : { status, error }
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ [SERVER_NAME]: ours })),
  }) as unknown as typeof fetch
}

const ports = {
  rootOf: () => null,
  focusedProjectId: () => null,
  activeFile: () => null,
  openInView: () => false,
  openTerminal: () => false,
  runProject: () => Promise.resolve({ ok: false as const, error: '이 시험은 도구를 안 부른다' }),
  readLogs: () => null,
}

function make(options: { enabled?: boolean; status?: string } = {}): {
  mcp: DesktopMcp
  fetchImpl: typeof fetch
  calls: () => number
} {
  const fetchImpl = fakeFetch(options.status ?? 'connected')
  const mcp = new DesktopMcp({
    settings: () => Promise.resolve({ desktopMcp: options.enabled ?? true }),
    // 주소는 이제 **프로젝트마다** 온다 (`opencode/serverPool.ts`). 여기서는 하나로 둔다 —
    // 프로젝트별로 갈리는지는 풀(`serverPool.test.ts`)이 겨눈다
    serverUrl: () => 'http://127.0.0.1:4096',
    ports,
    fetchImpl,
  })
  return {
    mcp,
    fetchImpl,
    calls: () => (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
  }
}

const projectA = { id: 'A', root: '/tmp/projA' }

describe('DesktopMcp', () => {
  let running: DesktopMcp | null = null

  afterEach(async () => {
    await running?.dispose()
    running = null
  })

  it('세션이 붙으면 등록한다', async () => {
    const { mcp, calls } = make()
    running = mcp
    await mcp.onProjectReady(projectA)
    expect(calls()).toBe(1)
  })

  // ready 는 소켓 상태가 흔들릴 때마다 여러 번 올라온다 (`ProjectSession.emitState`).
  // 그때마다 등록하면 opencode 가 같은 이름으로 붙었다 떼는 동안 도구 목록이 흔들린다.
  it('같은 프로젝트로 여러 번 불려도 한 번만 등록한다', async () => {
    const { mcp, calls } = make()
    running = mcp
    await mcp.onProjectReady(projectA)
    await mcp.onProjectReady(projectA)
    await mcp.onProjectReady(projectA)
    expect(calls()).toBe(1)
  })

  it('겹쳐 들어와도 한 번만 등록한다', async () => {
    const { mcp, calls } = make()
    running = mcp
    await Promise.all([mcp.onProjectReady(projectA), mcp.onProjectReady(projectA)])
    expect(calls()).toBe(1)
  })

  // **이 앱에서 가장 조용히 깨지는 자리다.** 서버가 재기동되면 등록이 사라지는데
  // 화면에는 아무 표시가 없다.
  it('끊겼다 다시 붙으면 다시 등록한다', async () => {
    const { mcp, calls } = make()
    running = mcp
    await mcp.onProjectReady(projectA)
    mcp.onProjectLost('A')
    await mcp.onProjectReady(projectA)
    expect(calls()).toBe(2)
  })

  // macOS 는 창을 다 닫아도 앱이 산다. 독으로 되살리면 세션이 새로 붙는데, 표시가 남아
  // 있으면 전부 "이미 등록됨" 으로 걸러진다 — 그 사이 opencode 가 재기동됐다면 도구가
  // 조용히 사라진 채로 굳는다.
  it('창이 사라졌다 되살아나면 다시 등록한다', async () => {
    const { mcp, calls } = make()
    running = mcp
    await mcp.onProjectReady(projectA)
    mcp.forgetRegistrations()
    await mcp.onProjectReady(projectA)
    expect(calls()).toBe(2)
  })

  // **`forgetRegistrations()` 가 서버까지 버리면 안 된다.**
  //
  // 창 수명 문제를 "창이 닫히면 DesktopMcp 를 버린다" 로 풀고 싶어지는데, 그러면 포트와
  // 토큰이 새로 나서 **opencode 에 등록해 둔 주소가 죽고** 재등록은 다음 핸드셰이크까지
  // 안 온다. 그래서 서버는 계속 듣고 등록 표시만 비운다 — 재등록 URL 이 그대로인 것이
  // 그 증거다 (contract-qa 가 대조하겠다고 한 네 번째 항목).
  it('되살아나도 포트와 토큰은 그대로다 — 등록해 둔 주소가 안 죽는다', async () => {
    const fetchImpl = fakeFetch()
    const mcp = new DesktopMcp({
      settings: () => Promise.resolve({ desktopMcp: true }),
      serverUrl: () => 'http://127.0.0.1:4096',
      ports,
      fetchImpl,
    })
    running = mcp

    const urlOf = (call: number): string => {
      const body = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
        .calls[call]![1].body
      return (JSON.parse(String(body)) as { config: { url: string; headers: Record<string, string> } })
        .config.url
    }
    const tokenOf = (call: number): string => {
      const body = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
        .calls[call]![1].body
      return (JSON.parse(String(body)) as { config: { headers: Record<string, string> } }).config
        .headers['Authorization']!
    }

    await mcp.onProjectReady(projectA)
    mcp.forgetRegistrations()
    await mcp.onProjectReady(projectA)

    expect(urlOf(1)).toBe(urlOf(0))
    expect(tokenOf(1)).toBe(tokenOf(0))
  })

  // **등록은 그 프로젝트의 서버에 간다.** 서버가 프로젝트마다 갈리면서(`serverPool.ts`)
  // 격리가 여기에도 한 겹 생겼다 — `?directory=` 로 한 겹, 서버 자체로 또 한 겹.
  // 앱 전역 주소 하나로 되돌아가면 A 의 도구가 B 세션에 보이는 자리로 돌아간다.
  it('프로젝트마다 자기 서버에 등록한다', async () => {
    const fetchImpl = fakeFetch()
    const mcp = new DesktopMcp({
      settings: () => Promise.resolve({ desktopMcp: true }),
      serverUrl: (projectId) =>
        projectId === 'A' ? 'http://127.0.0.1:55640' : 'http://127.0.0.1:55641',
      ports,
      fetchImpl,
    })
    running = mcp

    await mcp.onProjectReady(projectA)
    await mcp.onProjectReady({ id: 'B', root: '/tmp/projB' })

    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
    expect(calls[0]![0]).toContain('127.0.0.1:55640')
    expect(calls[1]![0]).toContain('127.0.0.1:55641')
  })

  // 신호가 오는 사이에 탭이 닫혀 서버까지 거둔 경우. 등록할 곳이 없다.
  it('그 프로젝트의 서버가 없으면 등록하지 않는다', async () => {
    const fetchImpl = fakeFetch()
    const mcp = new DesktopMcp({
      settings: () => Promise.resolve({ desktopMcp: true }),
      serverUrl: () => null,
      ports,
      fetchImpl,
    })
    running = mcp

    await mcp.onProjectReady(projectA)

    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0)
  })

  it('꺼져 있으면 등록하지 않는다', async () => {
    const { mcp, calls } = make({ enabled: false })
    running = mcp
    await mcp.onProjectReady(projectA)
    expect(calls()).toBe(0)
  })

  // 껐다 켜는 데 앱 재시작이 필요하면 안 된다 — 설정을 매번 읽는 이유다
  it('꺼진 채 지나갔어도 켜지면 다음 ready 에 등록한다', async () => {
    let enabled = false
    const fetchImpl = fakeFetch()
    const mcp = new DesktopMcp({
      settings: () => Promise.resolve({ desktopMcp: enabled }),
      serverUrl: () => 'http://127.0.0.1:4096',
      ports,
      fetchImpl,
    })
    running = mcp

    await mcp.onProjectReady(projectA)
    enabled = true
    await mcp.onProjectReady(projectA)

    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1)
  })

  // connected 가 아니면 붙지 못한 것이다 — 다음 ready 에 다시 시도해야 한다.
  // 우리 서버에 안 닿으면 오는 상태는 `failed` 다 (실측 — `disabled` 는 `enabled:false` 쪽이다).
  it('붙지 못한 등록은 다음 ready 에 다시 시도한다', async () => {
    const { mcp, calls } = make({ status: 'failed' })
    running = mcp
    await mcp.onProjectReady(projectA)
    await mcp.onProjectReady(projectA)
    expect(calls()).toBe(2)
  })

  // 등록 실패는 화면에 아무 증상이 없다 — 로그가 유일한 단서인데, 사유는 opencode 가 주는
  // `error` 에만 있다. 그걸 버리면 방화벽·포트 충돌·주소 오타를 구별할 수 없다.
  it('실패 사유를 로그에 싣는다', async () => {
    const lines: string[] = []
    const mcp = new DesktopMcp({
      settings: () => Promise.resolve({ desktopMcp: true }),
      serverUrl: () => 'http://127.0.0.1:4096',
      ports,
      fetchImpl: fakeFetch('failed', 'SSE error: Unable to connect.'),
      log: (line) => lines.push(line),
    })
    running = mcp

    await mcp.onProjectReady(projectA)
    expect(lines[0]).toContain('failed')
    expect(lines[0]).toContain('SSE error: Unable to connect.')
  })

  // MCP 는 있으면 좋은 것이지 앱의 조건이 아니다 — 실패가 세션을 죽이면 안 된다.
  //
  // **던지지 않는 것만으로는 부족하다.** 조용히 삼키면 등록이 안 된 사실이 아무 데도 안 남고,
  // 화면에는 증상이 없다(도구가 그냥 안 뜬다). 사유가 로그에 닿는지까지 본다 —
  // 실제로 이 경로로 오는 흔한 실패가 **비밀번호 건 서버에 비밀번호 없이 붙는 것**이고,
  // 그때 유일한 단서가 `HTTP 401` 한 줄이다 (contract-qa 실측).
  it('등록이 실패해도 던지지 않는다 — 대신 사유를 로그에 남긴다', async () => {
    const lines: string[] = []
    const fetchImpl = vi.fn().mockRejectedValue(new Error('HTTP 401')) as unknown as typeof fetch
    const mcp = new DesktopMcp({
      settings: () => Promise.resolve({ desktopMcp: true }),
      serverUrl: () => 'http://127.0.0.1:4096',
      ports,
      fetchImpl,
      log: (line) => lines.push(line),
    })
    running = mcp

    await expect(mcp.onProjectReady(projectA)).resolves.toBeUndefined()
    expect(lines[0]).toContain('MCP 등록 실패')
    expect(lines[0]).toContain('HTTP 401')
  })
})
