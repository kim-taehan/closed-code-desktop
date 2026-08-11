import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopMcp } from './desktopMcp'
import { SERVER_NAME } from './rpc'

// 등록 **시점**만 겨눈다. 무엇을 보내는가는 register.test.ts 가 본다.
//
// 가장 중요한 케이스는 **재연결 후 다시 등록하는가** 다. opencode 의 등록은 instance
// 수명이라(실측: `POST /instance/dispose` 뒤 `GET /mcp` 가 `{}`) 한 번 등록하고 끝내면
// 서버가 재기동된 뒤 도구가 조용히 사라진다 — 화면에는 아무 증상이 없다.

function fakeFetch(status = 'connected'): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ [SERVER_NAME]: { status } })),
  }) as unknown as typeof fetch
}

const ports = {
  rootOf: () => null,
  focusedProjectId: () => null,
  activeFile: () => null,
  openInView: () => false,
}

function make(options: { enabled?: boolean; status?: string } = {}): {
  mcp: DesktopMcp
  fetchImpl: typeof fetch
  calls: () => number
} {
  const fetchImpl = fakeFetch(options.status ?? 'connected')
  const mcp = new DesktopMcp({
    settings: () =>
      Promise.resolve({
        desktopMcp: options.enabled ?? true,
        opencodeUrl: 'http://127.0.0.1:4096',
      }),
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
      settings: () => Promise.resolve({ desktopMcp: enabled, opencodeUrl: 'http://127.0.0.1:4096' }),
      ports,
      fetchImpl,
    })
    running = mcp

    await mcp.onProjectReady(projectA)
    enabled = true
    await mcp.onProjectReady(projectA)

    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1)
  })

  // connected 가 아니면 붙지 못한 것이다 — 다음 ready 에 다시 시도해야 한다
  it('붙지 못한 등록은 다음 ready 에 다시 시도한다', async () => {
    const { mcp, calls } = make({ status: 'disabled' })
    running = mcp
    await mcp.onProjectReady(projectA)
    await mcp.onProjectReady(projectA)
    expect(calls()).toBe(2)
  })

  // MCP 는 있으면 좋은 것이지 앱의 조건이 아니다 — 실패가 세션을 죽이면 안 된다
  it('등록이 실패해도 던지지 않는다', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('서버 없음')) as unknown as typeof fetch
    const mcp = new DesktopMcp({
      settings: () => Promise.resolve({ desktopMcp: true, opencodeUrl: 'http://127.0.0.1:4096' }),
      ports,
      fetchImpl,
    })
    running = mcp
    await expect(mcp.onProjectReady(projectA)).resolves.toBeUndefined()
  })
})
