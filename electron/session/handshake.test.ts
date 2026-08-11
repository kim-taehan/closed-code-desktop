import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntimeServer } from '../../tests/fake-runtime/FakeRuntimeServer'
import { AuthState } from '../../shared/protocol/kinds'
import { WsConnection } from '../ws/connection'
import { Handshake, type HandshakeStage, type HandshakeState } from './handshake'

let server: FakeRuntimeServer | null = null
let connection: WsConnection | null = null

afterEach(async () => {
  connection?.dispose()
  connection = null
  await server?.stop()
  server = null
})

async function setup(serverOptions?: ConstructorParameters<typeof FakeRuntimeServer>[0]) {
  server = new FakeRuntimeServer(serverOptions)
  const port = await server.start()
  connection = new WsConnection({ url: `ws://127.0.0.1:${port}/ws?csid=c1`, autoReconnect: false })
  return { server, connection }
}

function makeHandshake(
  connection: WsConnection,
  overrides: Partial<ConstructorParameters<typeof Handshake>[1]> = {},
) {
  const states: HandshakeState[] = []
  const handshake = new Handshake(connection, {
    workspacePath: '/tmp/project',
    ...overrides,
  })
  handshake.onStateChange((state) => states.push(state))
  return { handshake, states }
}

const stages = (states: HandshakeState[]): HandshakeStage[] => states.map((s) => s.stage)

describe('Handshake 성공 경로', () => {
  it('네 단계를 순서대로 거쳐 ready 에 도달한다', async () => {
    const ctx = await setup()
    const { handshake, states } = makeHandshake(ctx.connection)

    const done = handshake.run()
    await ctx.connection.connect()
    await done

    expect(stages(states)).toEqual(['awaiting_connected', 'authenticating', 'syncing_workspace', 'ready'])
    expect(handshake.state.stage).toBe('ready')
    handshake.dispose()
  })

  it('auth_request 와 workspace_sync 를 camelCase 로 보낸다', async () => {
    const ctx = await setup()
    const { handshake } = makeHandshake(ctx.connection)

    const done = handshake.run()
    await ctx.connection.connect()
    await done

    const auth = ctx.server.received.find((f) => f.action === 'auth_request')
    // **자격증명은 싣지 않는다** — opencode 에 라이선스가 없어 어댑터가 늘 valid 로 답한다.
    // 프레임 자체는 남는다: 위층 핸드셰이크 4단계가 이 왕복을 그대로 쓴다.
    expect(auth?.data?.['credentials']).toBeUndefined()
    // 별칭이 없는 필드는 snake_case 가 정답이다
    expect(auth?.data?.['ide_type']).toBe('desktop')

    const sync = ctx.server.received.find((f) => f.action === 'workspace_sync')
    expect(sync?.data?.['workspace']).toMatchObject({ workspacePath: '/tmp/project' })
    // 프로젝트를 실어 보낸다 — 비우면 runtime 이 default project 로 접어 이력 스코프가 무너진다.
    // projectName 을 안 주면 경로 basename 을 쓴다.
    expect(sync?.data?.['projects']).toEqual([{ projectName: 'project', projectPath: '/tmp/project' }])
    handshake.dispose()
  })

  it('projectName 을 주면 workspace_sync 에 그대로 실어 보낸다', async () => {
    const ctx = await setup()
    const { handshake } = makeHandshake(ctx.connection, { projectName: '내 프로젝트' })

    const done = handshake.run()
    await ctx.connection.connect()
    await done

    const sync = ctx.server.received.find((f) => f.action === 'workspace_sync')
    expect(sync?.data?.['projects']).toEqual([{ projectName: '내 프로젝트', projectPath: '/tmp/project' }])
    handshake.dispose()
  })

  it('모든 요청에 reqId 가 붙는다', async () => {
    const ctx = await setup()
    const { handshake } = makeHandshake(ctx.connection)

    const done = handshake.run()
    await ctx.connection.connect()
    await done

    for (const frame of ctx.server.received) expect(frame.reqId).toBeTruthy()
    handshake.dispose()
  })

  it('인증 응답의 action 이 auth_request 로 에코돼도 인식한다', async () => {
    // 실측(runtime 3.4.3): 인증 결과가 action:"auth_state" 가 아니라
    // 요청 action 을 에코한 action:"auth_request" 로 돌아온다.
    // action 이름으로 판정하면 여기서 핸드셰이크가 조용히 멈춘다 — A7 스모크에서 실제로 겪었다.
    const ctx = await setup({ authReplyAction: 'auth_request' })
    const { handshake, states } = makeHandshake(ctx.connection)

    const done = handshake.run()
    await ctx.connection.connect()
    await done

    expect(stages(states)).toEqual(['awaiting_connected', 'authenticating', 'syncing_workspace', 'ready'])
    handshake.dispose()
  })

  it('인증 응답의 action 이 문서대로 auth_state 여도 인식한다', async () => {
    const ctx = await setup({ authReplyAction: 'auth_state' })
    const { handshake } = makeHandshake(ctx.connection)

    const done = handshake.run()
    await ctx.connection.connect()
    await done

    expect(handshake.state.stage).toBe('ready')
    handshake.dispose()
  })

  it('not_ready 에서는 아직 ready 로 넘어가지 않는다', async () => {
    const ctx = await setup()
    const { handshake, states } = makeHandshake(ctx.connection)

    const done = handshake.run()
    await ctx.connection.connect()
    await done

    // 가짜 서버는 not_ready 를 먼저 보낸다. ready 는 한 번만 기록돼야 한다.
    expect(stages(states).filter((s) => s === 'ready')).toHaveLength(1)
    handshake.dispose()
  })
})

describe('Handshake 실패 경로 — 어느 단계인지 식별 가능해야 한다', () => {
  it('connected 가 오지 않으면 awaiting_connected 로 실패한다', async () => {
    // 서버 없이 소켓만 흉내내는 최소 transport
    const noop = {
      isOpen: true,
      send: () => true,
      onOpen: () => () => {},
      onMessage: () => () => {},
      onClose: () => () => {},
      onError: () => () => {},
      close: () => {},
    }
    const handshake = new Handshake(noop, {
      workspacePath: '/tmp',
      timeouts: { connected: 40 },
    })

    await expect(handshake.run()).rejects.toThrow(/awaiting_connected/)
    expect(handshake.state.failure?.stage).toBe('awaiting_connected')
    expect(handshake.state.failure?.reason).toContain('system/connected')
    handshake.dispose()
  })

  it('소켓이 열리기 전에는 단계 타이머를 걸지 않는다', async () => {
    // 회귀 방지: run() 시점에 타이머를 걸면 연결 지연과 경쟁해
    // "연결이 느렸을 뿐인데 핸드셰이크 실패"가 된다. 연결 실패는 WsConnection 의 책임이다.
    let fireOpen = () => {}
    const pending = {
      isOpen: false,
      send: () => true,
      onOpen: (handler: () => void) => {
        fireOpen = handler
        return () => {}
      },
      onMessage: () => () => {},
      onClose: () => () => {},
      onError: () => () => {},
      close: () => {},
    }

    const handshake = new Handshake(pending, {
      workspacePath: '/tmp',
      timeouts: { connected: 40 },
    })
    const settled = handshake.run().then(
      () => 'resolved',
      () => 'rejected',
    )

    // 아직 열리지 않았으므로 타임아웃이 발화하면 안 된다
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(handshake.state.stage).toBe('idle')

    // 열린 뒤에야 타이머가 돌기 시작한다
    fireOpen()
    expect(handshake.state.stage).toBe('awaiting_connected')
    await expect(settled).resolves.toBe('rejected')
    expect(handshake.state.failure?.stage).toBe('awaiting_connected')
    handshake.dispose()
  })

  it('인증이 invalid 면 authenticating 으로 실패하고 사유를 담는다', async () => {
    const ctx = await setup({ authState: AuthState.INVALID })
    const { handshake } = makeHandshake(ctx.connection)

    const done = handshake.run()
    await ctx.connection.connect()

    await expect(done).rejects.toThrow(/authenticating/)
    expect(handshake.state.stage).toBe('failed')
    expect(handshake.state.failure?.stage).toBe('authenticating')
    expect(handshake.state.failure?.reason).toContain('인증 실패')
    handshake.dispose()
  })

  it('workspace_state 가 오지 않으면 syncing_workspace 로 실패한다', async () => {
    const ctx = await setup()
    const { handshake } = makeHandshake(ctx.connection, { timeouts: { workspace: 40 } })

    // workspace_sync 응답을 막기 위해 소켓을 가로챈다: 서버가 응답하기 전 상태를 흉내낸다
    const original = ctx.connection.send.bind(ctx.connection)
    vi.spyOn(ctx.connection, 'send').mockImplementation((payload: string) => {
      if (payload.includes('workspace_sync')) return true // 보내지 않고 성공한 척
      return original(payload)
    })

    const done = handshake.run()
    await ctx.connection.connect()

    await expect(done).rejects.toThrow(/syncing_workspace/)
    expect(handshake.state.failure?.stage).toBe('syncing_workspace')
    expect(handshake.state.failure?.reason).toContain('workspace_state')
    handshake.dispose()
  })

  it('workspacePath 가 거부되면 error 프레임으로 실패한다', async () => {
    const ctx = await setup()
    const { handshake } = makeHandshake(ctx.connection, { workspacePath: '' })

    // 빈 경로는 가짜 서버가 workspacePath 누락으로 거부한다
    const original = ctx.connection.send.bind(ctx.connection)
    vi.spyOn(ctx.connection, 'send').mockImplementation((payload: string) =>
      original(payload.replace('"workspacePath":""', '"workspace_path":""')),
    )

    const done = handshake.run()
    await ctx.connection.connect()

    await expect(done).rejects.toThrow(/runtime 오류/)
    expect(handshake.state.failure?.code).toBe('VALIDATION_ERROR')
    handshake.dispose()
  })

  it('두 번 실행하면 거부한다', async () => {
    const ctx = await setup()
    const { handshake } = makeHandshake(ctx.connection)

    const done = handshake.run()
    await ctx.connection.connect()
    await done

    await expect(handshake.run()).rejects.toThrow(/이미 ready/)
    handshake.dispose()
  })
})

describe('Handshake 와 chat_request 게이트', () => {
  it('workspace_sync 를 건너뛰면 chat_request 가 AUTH_REQUIRED 로 죽는다', async () => {
    // 설계 §4.2 의 핵심 함정. 핸드셰이크를 지키지 않은 클라이언트가 겪는 일을 재현한다.
    const ctx = await setup({ onChatRequest: () => [] })
    const frames: Record<string, unknown>[] = []
    ctx.connection.onMessage((raw) => frames.push(JSON.parse(raw) as Record<string, unknown>))
    await ctx.connection.connect()

    ctx.connection.send(JSON.stringify({ kind: 'auth', action: 'auth_request', reqId: 'a1', data: {} }))
    await vi.waitFor(() =>
      expect(frames.some((f) => f['kind'] === 'auth' && (f['data'] as Record<string, unknown>)['state'])).toBe(true),
    )

    // workspace_sync 없이 바로 채팅
    ctx.connection.send(JSON.stringify({ kind: 'chat', action: 'chat_request', reqId: 'c1', data: { query: 'hi' } }))

    await vi.waitFor(() => {
      const rejected = frames.find(
        (f) => f['kind'] === 'auth' && (f['data'] as Record<string, unknown>)['authErrorCode'] === 'AUTH_REQUIRED',
      )
      expect(rejected).toBeTruthy()
    })
    // stream_start 는 오지 않는다
    expect(frames.some((f) => f['action'] === 'stream_start')).toBe(false)
  })
})
