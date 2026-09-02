import { describe, expect, it } from 'vitest'
import { FakeRuntimeProtocol, type FakeRuntimeOptions } from './runtimeProtocol'
import { textOnlyTurn } from './turnScript'
import { AuthState } from '../../shared/protocol/kinds'

// 하네스 자체 테스트. 이 대역이 계약을 제대로 재생해야 이후 A4~C1 테스트가 의미를 갖는다.
//
// **`FakeRuntimeServer.test.ts` 에서 옮겨 왔다 (2026-08-26).** 예전에는 진짜 WebSocket
// 서버를 띄우고 `ws` 클라이언트로 붙어서 쟀는데, 재던 것은 **소켓이 아니라 프레임 계약**이라
// 전송을 걷어내도 그대로 성립한다. 소켓이 없어지면서 프레임을 기다리던 `waitFor` 배관
// (66줄)도 함께 없어졌다 — 이제 동기라 그냥 배열을 본다.
//
// 옮기지 못한 것 하나: 「csid 쿼리를 기록한다」. csid 는 WebSocket URL 의 질의 문자열이라
// 전송과 함께 사라졌다 (`WsConnection` 이 붙이던 것이고, opencode 에는 그 개념이 없다).

interface Harness {
  runtime: FakeRuntimeProtocol
  frames: Record<string, unknown>[]
  send(frame: unknown): void
}

function harness(options: FakeRuntimeOptions = {}): Harness {
  const frames: Record<string, unknown>[] = []
  // 나가는 프레임을 **선언된 모양이 아니라 실제 필드**로 본다 — 계약을 재는 자리라
  // `ServerFrame` 타입이 빠뜨린 필드(ping_id 등)까지 그대로 단언할 수 있어야 한다
  const runtime = new FakeRuntimeProtocol(options, (frame) =>
    frames.push(frame as unknown as Record<string, unknown>),
  )
  runtime.greet()
  return { runtime, frames, send: (frame) => runtime.handle(JSON.stringify(frame)) }
}

const found = (frames: Record<string, unknown>[], action: string) => frames.find((f) => f['action'] === action)

// 인증 응답은 action 이름이 아니라 payload 모양으로 알아본다.
// 실측: runtime 은 auth_state 가 아니라 요청 action(auth_request)을 에코한다.
const authReply = (frames: Record<string, unknown>[]) =>
  frames.find(
    (f) => f['kind'] === 'auth' && typeof (f['data'] as Record<string, unknown> | undefined)?.['state'] === 'string',
  )

const dataOf = (frame: Record<string, unknown> | undefined) => frame?.['data'] as Record<string, unknown> | undefined

/** 인증까지 마친 상태 */
function authenticated(options: FakeRuntimeOptions = {}): Harness {
  const kit = harness(options)
  kit.send({ kind: 'auth', action: 'auth_request', reqId: 'auth-1', data: {} })
  return kit
}

/** workspace_sync 까지 마쳐 chat_request 를 받을 수 있는 상태 */
function ready(options: FakeRuntimeOptions = {}): Harness {
  const kit = authenticated(options)
  kit.send({
    kind: 'workspace',
    action: 'workspace_sync',
    reqId: 'ws-1',
    data: { workspace: { workspacePath: '/tmp/project' } },
  })
  return kit
}

describe('가짜 런타임 핸드셰이크', () => {
  it('붙으면 요청 없이 connected 를 보낸다', () => {
    const { frames } = harness()

    const frame = found(frames, 'connected')
    expect(frame?.['kind']).toBe('system')
    expect(dataOf(frame)?.['sessionId']).toBe('fake-session')
  })

  it('auth_request 에 ack 와 auth_state(valid) 로 답한다', () => {
    const kit = harness()
    kit.send({
      kind: 'auth',
      action: 'auth_request',
      reqId: 'r1',
      data: { type: 'license_key', credentials: { licenseKey: 'k' } },
    })

    expect(dataOf(authReply(kit.frames))?.['state']).toBe('valid')
    expect(kit.frames.some((f) => f['action'] === 'ack' && f['replyTo'] === 'r1')).toBe(true)
  })

  it('authState 를 invalid 로 설정하면 그대로 돌려준다', () => {
    const kit = harness({ authState: AuthState.INVALID })
    kit.send({ kind: 'auth', action: 'auth_request', reqId: 'r1', data: {} })

    expect(dataOf(authReply(kit.frames))?.['state']).toBe('invalid')
  })

  it('reqId 가 없으면 VALIDATION_ERROR 로 거부한다', () => {
    const kit = harness()
    kit.send({ kind: 'auth', action: 'auth_request', data: {} })

    expect(dataOf(found(kit.frames, 'error'))?.['code']).toBe('VALIDATION_ERROR')
  })

  it('인증 전 workspace_sync 는 AUTH_REQUIRED 로 거부한다', () => {
    const kit = harness()
    kit.send({
      kind: 'workspace',
      action: 'workspace_sync',
      reqId: 'r1',
      data: { workspace: { workspacePath: '/tmp' } },
    })

    expect(dataOf(authReply(kit.frames))?.['authErrorCode']).toBe('AUTH_REQUIRED')
  })
})

describe('가짜 런타임 workspace_sync', () => {
  it('not_ready 를 거쳐 ready 로 간다', () => {
    const kit = authenticated()
    kit.send({
      kind: 'workspace',
      action: 'workspace_sync',
      reqId: 'ws-1',
      data: { workspace: { workspacePath: '/tmp/project' } },
    })

    const states = kit.frames
      .filter((f) => f['action'] === 'workspace_state')
      .map((f) => dataOf(f)?.['state'])
    expect(states).toEqual(['not_ready', 'ready'])
  })

  it('workspacePath 를 snake_case 로 보내면 필수 필드 누락으로 거부한다', () => {
    const kit = authenticated()
    kit.send({
      kind: 'workspace',
      action: 'workspace_sync',
      reqId: 'ws-1',
      data: { workspace: { workspace_path: '/tmp/project' } },
    })

    expect(dataOf(found(kit.frames, 'error'))?.['message']).toContain('workspacePath')
  })

  it('workspace_sync 없이 온 chat_request 는 AUTH_REQUIRED 로 죽는다', () => {
    const kit = authenticated({ onChatRequest: () => [] })
    kit.send({ kind: 'chat', action: 'chat_request', reqId: 'c1', data: { query: 'hello' } })

    const rejected = kit.frames.find((f) => dataOf(f)?.['authErrorCode'] === 'AUTH_REQUIRED')
    expect(rejected).toBeTruthy()
  })
})

describe('가짜 런타임 턴 스트림과 하트비트', () => {
  it('chat_request 에 스크립트된 턴을 흘려준다', () => {
    const kit = ready({
      onChatRequest: (context) => textOnlyTurn({ ...context, turnId: 'turn-1' }, '안녕하세요'),
    })

    kit.send({ kind: 'chat', action: 'chat_request', reqId: 'c1', data: { query: 'hello' } })

    expect(dataOf(found(kit.frames, 'stream_end'))?.['terminal']).toBe(true)
    const actions = kit.frames.filter((f) => f['kind'] === 'chat').map((f) => f['action'])
    expect(actions).toEqual(['stream_start', 'stream_chunk', 'stream_chunk', 'stream_chunk', 'stream_end'])
  })

  it('ping 을 보내고 클라이언트의 pong 을 기록한다', () => {
    const kit = harness()

    kit.runtime.sendPing('p-1')
    expect(found(kit.frames, 'ping')?.['ping_id']).toBe('p-1')

    kit.send({ kind: 'system', action: 'pong', ping_id: 'p-1' })
    expect(kit.runtime.pongIds).toEqual(['p-1'])
  })
})
