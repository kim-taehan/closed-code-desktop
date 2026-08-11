import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { FakeRuntimeServer } from './FakeRuntimeServer'
import { textOnlyTurn } from './turnScript'
import { AuthState } from '../../shared/protocol/kinds'

// 하네스 자체 테스트. 이 서버가 계약을 제대로 재생해야 이후 A4~C1 테스트가 의미를 갖는다.

let server: FakeRuntimeServer | null = null

afterEach(async () => {
  await server?.stop()
  server = null
})

interface Client {
  socket: WebSocket
  frames: Record<string, unknown>[]
  send(frame: unknown): void
  waitFor(predicate: (frame: Record<string, unknown>) => boolean, label: string): Promise<Record<string, unknown>>
  close(): void
}

async function connect(port: number, csid = 'csid-1'): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?csid=${csid}`)
  const frames: Record<string, unknown>[] = []
  const waiters: { predicate: (f: Record<string, unknown>) => boolean; resolve: (f: Record<string, unknown>) => void }[] = []

  socket.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as Record<string, unknown>
    frames.push(frame)
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i]!
      if (waiter.predicate(frame)) {
        waiters.splice(i, 1)
        waiter.resolve(frame)
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })

  return {
    socket,
    frames,
    send: (frame) => socket.send(JSON.stringify(frame)),
    waitFor(predicate, label) {
      const existing = frames.find(predicate)
      if (existing) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} 프레임을 기다리다 타임아웃`)), 2000)
        waiters.push({
          predicate,
          resolve: (frame) => {
            clearTimeout(timer)
            resolve(frame)
          },
        })
      })
    },
    close: () => socket.close(),
  }
}

const isAction = (action: string) => (frame: Record<string, unknown>) => frame['action'] === action

// 인증 응답은 action 이름이 아니라 payload 모양으로 알아본다.
// 실측: runtime 은 auth_state 가 아니라 요청 action(auth_request)을 에코한다.
const isAuthReply = (frame: Record<string, unknown>) =>
  frame['kind'] === 'auth' && typeof (frame['data'] as Record<string, unknown> | undefined)?.['state'] === 'string'

describe('FakeRuntimeServer 핸드셰이크', () => {
  it('연결하면 요청 없이 connected 를 보낸다', async () => {
    server = new FakeRuntimeServer()
    const client = await connect(await server.start())

    const frame = await client.waitFor(isAction('connected'), 'connected')
    expect(frame['kind']).toBe('system')
    expect((frame['data'] as Record<string, unknown>)['sessionId']).toBe('fake-session')
    client.close()
  })

  it('csid 쿼리를 기록한다', async () => {
    server = new FakeRuntimeServer()
    const client = await connect(await server.start(), 'csid-abc')
    await client.waitFor(isAction('connected'), 'connected')

    expect(server.connectedCsids).toEqual(['csid-abc'])
    client.close()
  })

  it('auth_request 에 ack 와 auth_state(valid) 로 답한다', async () => {
    server = new FakeRuntimeServer()
    const client = await connect(await server.start())
    await client.waitFor(isAction('connected'), 'connected')

    client.send({
      kind: 'auth',
      action: 'auth_request',
      reqId: 'r1',
      data: { type: 'license_key', credentials: { licenseKey: 'k' } },
    })

    const state = await client.waitFor(isAuthReply, '인증 응답')
    expect((state['data'] as Record<string, unknown>)['state']).toBe('valid')
    expect(client.frames.some((f) => f['action'] === 'ack' && f['replyTo'] === 'r1')).toBe(true)
    client.close()
  })

  it('authState 를 invalid 로 설정하면 그대로 돌려준다', async () => {
    server = new FakeRuntimeServer({ authState: AuthState.INVALID })
    const client = await connect(await server.start())
    await client.waitFor(isAction('connected'), 'connected')

    client.send({ kind: 'auth', action: 'auth_request', reqId: 'r1', data: {} })
    const state = await client.waitFor(isAuthReply, '인증 응답')
    expect((state['data'] as Record<string, unknown>)['state']).toBe('invalid')
    client.close()
  })

  it('reqId 가 없으면 VALIDATION_ERROR 로 거부한다', async () => {
    server = new FakeRuntimeServer()
    const client = await connect(await server.start())
    await client.waitFor(isAction('connected'), 'connected')

    client.send({ kind: 'auth', action: 'auth_request', data: {} })
    const error = await client.waitFor(isAction('error'), 'error')
    expect((error['data'] as Record<string, unknown>)['code']).toBe('VALIDATION_ERROR')
    client.close()
  })

  it('인증 전 workspace_sync 는 AUTH_REQUIRED 로 거부한다', async () => {
    server = new FakeRuntimeServer()
    const client = await connect(await server.start())
    await client.waitFor(isAction('connected'), 'connected')

    client.send({
      kind: 'workspace',
      action: 'workspace_sync',
      reqId: 'r1',
      data: { workspace: { workspacePath: '/tmp' } },
    })

    const state = await client.waitFor(isAuthReply, '인증 응답')
    expect((state['data'] as Record<string, unknown>)['authErrorCode']).toBe('AUTH_REQUIRED')
    client.close()
  })
})

describe('FakeRuntimeServer workspace_sync', () => {
  async function authenticated(port: number): Promise<Client> {
    const client = await connect(port)
    await client.waitFor(isAction('connected'), 'connected')
    client.send({ kind: 'auth', action: 'auth_request', reqId: 'auth-1', data: {} })
    await client.waitFor(isAuthReply, '인증 응답')
    return client
  }

  it('not_ready 를 거쳐 ready 로 간다', async () => {
    server = new FakeRuntimeServer()
    const client = await authenticated(await server.start())

    client.send({
      kind: 'workspace',
      action: 'workspace_sync',
      reqId: 'ws-1',
      data: { workspace: { workspacePath: '/tmp/project' } },
    })

    await client.waitFor(
      (f) => f['action'] === 'workspace_state' && (f['data'] as Record<string, unknown>)['state'] === 'ready',
      'workspace_state ready',
    )
    const states = client.frames
      .filter((f) => f['action'] === 'workspace_state')
      .map((f) => (f['data'] as Record<string, unknown>)['state'])
    expect(states).toEqual(['not_ready', 'ready'])
    client.close()
  })

  it('workspacePath 를 snake_case 로 보내면 필수 필드 누락으로 거부한다', async () => {
    server = new FakeRuntimeServer()
    const client = await authenticated(await server.start())

    client.send({
      kind: 'workspace',
      action: 'workspace_sync',
      reqId: 'ws-1',
      data: { workspace: { workspace_path: '/tmp/project' } },
    })

    const error = await client.waitFor(isAction('error'), 'error')
    expect((error['data'] as Record<string, unknown>)['message']).toContain('workspacePath')
    client.close()
  })

  it('workspace_sync 없이 온 chat_request 는 AUTH_REQUIRED 로 죽는다', async () => {
    server = new FakeRuntimeServer({ onChatRequest: () => [] })
    const client = await authenticated(await server.start())

    client.send({ kind: 'chat', action: 'chat_request', reqId: 'c1', data: { query: 'hello' } })

    const state = await client.waitFor(
      (f) => isAuthReply(f) && (f['data'] as Record<string, unknown>)['authErrorCode'] === 'AUTH_REQUIRED',
      'AUTH_REQUIRED',
    )
    expect(state).toBeTruthy()
    client.close()
  })
})

describe('FakeRuntimeServer 턴 스트림과 하트비트', () => {
  async function ready(port: number): Promise<Client> {
    const client = await connect(port)
    await client.waitFor(isAction('connected'), 'connected')
    client.send({ kind: 'auth', action: 'auth_request', reqId: 'auth-1', data: {} })
    await client.waitFor(isAuthReply, '인증 응답')
    client.send({
      kind: 'workspace',
      action: 'workspace_sync',
      reqId: 'ws-1',
      data: { workspace: { workspacePath: '/tmp/project' } },
    })
    await client.waitFor(
      (f) => f['action'] === 'workspace_state' && (f['data'] as Record<string, unknown>)['state'] === 'ready',
      'ready',
    )
    return client
  }

  it('chat_request 에 스크립트된 턴을 흘려준다', async () => {
    server = new FakeRuntimeServer({
      onChatRequest: (context) =>
        textOnlyTurn({ ...context, turnId: 'turn-1' }, '안녕하세요'),
    })
    const client = await ready(await server.start())

    client.send({ kind: 'chat', action: 'chat_request', reqId: 'c1', data: { query: 'hello' } })
    const end = await client.waitFor(isAction('stream_end'), 'stream_end')

    expect((end['data'] as Record<string, unknown>)['terminal']).toBe(true)
    const actions = client.frames.filter((f) => f['kind'] === 'chat').map((f) => f['action'])
    expect(actions).toEqual(['stream_start', 'stream_chunk', 'stream_chunk', 'stream_chunk', 'stream_end'])
    client.close()
  })

  it('ping 을 보내고 클라이언트의 pong 을 기록한다', async () => {
    server = new FakeRuntimeServer()
    const client = await connect(await server.start())
    await client.waitFor(isAction('connected'), 'connected')

    server.sendPing('p-1')
    const ping = await client.waitFor(isAction('ping'), 'ping')
    expect(ping['ping_id']).toBe('p-1')

    client.send({ kind: 'system', action: 'pong', ping_id: 'p-1' })
    await expect.poll(() => server!.pongIds).toEqual(['p-1'])
    client.close()
  })
})
