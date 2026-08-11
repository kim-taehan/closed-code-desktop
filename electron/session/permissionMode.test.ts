import { afterEach, describe, expect, it, vi } from 'vitest'
import { PermissionMode } from '../../shared/protocol/kinds'
import { FakeRuntimeServer } from '../../tests/fake-runtime/FakeRuntimeServer'
import { WsConnection } from '../ws/connection'
import { Handshake } from './handshake'
import { PermissionModeController } from './permissionMode'

// 권한 모드 전환 (ADR-011 §4).

let server: FakeRuntimeServer | null = null
let connection: WsConnection | null = null

afterEach(async () => {
  connection?.dispose()
  connection = null
  await server?.stop()
  server = null
})

async function setup() {
  server = new FakeRuntimeServer()
  const port = await server.start()
  connection = new WsConnection({ url: `ws://127.0.0.1:${port}/ws`, autoReconnect: false })

  const controller = new PermissionModeController(connection)
  const seen: PermissionMode[] = []
  controller.onChange((mode) => seen.push(mode))
  controller.start()

  const handshake = new Handshake(connection, { workspacePath: '/tmp' })
  const ready = handshake.run()
  await connection.connect()
  await ready

  return { controller, seen, handshake, server: server!, connection: connection! }
}

describe('모드 전환', () => {
  it('기본값은 default 다', async () => {
    const ctx = await setup()
    expect(ctx.controller.current).toBe(PermissionMode.DEFAULT)
    ctx.handshake.dispose()
  })

  it('set 하면 runtime 에 mode 를 보낸다', async () => {
    const ctx = await setup()
    ctx.controller.set(PermissionMode.PLAN)

    await vi.waitFor(() => {
      const sent = ctx.server.received.find((f) => f.action === 'set_permission_mode')
      expect(sent?.data).toEqual({ mode: 'plan' })
    })
    ctx.handshake.dispose()
  })

  it('응답을 기다리지 않고 화면을 먼저 바꾼다 — 토글이 굼뜨면 안 된다', async () => {
    const ctx = await setup()
    ctx.controller.set(PermissionMode.PLAN)

    // 서버 응답 전인데 이미 반영돼 있어야 한다
    expect(ctx.controller.current).toBe(PermissionMode.PLAN)
    expect(ctx.seen).toContain(PermissionMode.PLAN)
    ctx.handshake.dispose()
  })

  it('runtime 이 확정하면 acknowledged 가 갱신된다', async () => {
    const ctx = await setup()
    ctx.controller.set(PermissionMode.PLAN)

    await vi.waitFor(() => expect(ctx.controller.acknowledged).toBe(PermissionMode.PLAN))
    ctx.handshake.dispose()
  })

  it('runtime 이 다른 값을 확정하면 그쪽을 따른다', async () => {
    const ctx = await setup()
    ctx.controller.set(PermissionMode.PLAN)
    await vi.waitFor(() => expect(ctx.controller.acknowledged).toBe(PermissionMode.PLAN))

    // 서버가 임의로 default 로 되돌린 상황
    ctx.server.push([
      { kind: 'workspace', action: 'permission_mode_changed', data: { mode: 'default' } },
    ])

    await vi.waitFor(() => expect(ctx.controller.current).toBe(PermissionMode.DEFAULT))
    ctx.handshake.dispose()
  })
})

describe('재연결 후 재적용', () => {
  it('기본값이 아니면 다시 보낸다 — runtime 은 세션 메모리만 쓴다', async () => {
    const ctx = await setup()
    ctx.controller.set(PermissionMode.PLAN)
    await vi.waitFor(() => expect(ctx.controller.acknowledged).toBe(PermissionMode.PLAN))

    const before = ctx.server.received.filter((f) => f.action === 'set_permission_mode').length
    ctx.controller.reapply()

    await vi.waitFor(() => {
      const after = ctx.server.received.filter((f) => f.action === 'set_permission_mode').length
      expect(after).toBe(before + 1)
    })
    ctx.handshake.dispose()
  })

  it('기본값이면 보내지 않는다 — runtime 도 기본값으로 시작한다', async () => {
    const ctx = await setup()
    ctx.controller.reapply()

    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(ctx.server.received.filter((f) => f.action === 'set_permission_mode')).toHaveLength(0)
    ctx.handshake.dispose()
  })
})

describe('잘못된 값', () => {
  it('runtime 이 모르는 값은 BAD_REQUEST 로 거부한다', async () => {
    const ctx = await setup()

    // 컨트롤러를 우회해 직접 보낸다
    ctx.connection.send(
      JSON.stringify({
        kind: 'workspace',
        action: 'set_permission_mode',
        reqId: 'pm-1',
        data: { mode: 'bypassPermissions' },
      }),
    )

    const frames: Record<string, unknown>[] = []
    ctx.connection.onMessage((raw) => frames.push(JSON.parse(raw) as Record<string, unknown>))

    await vi.waitFor(() => {
      const error = frames.find(
        (f) => f['action'] === 'error' && (f['data'] as Record<string, unknown>)['code'] === 'BAD_REQUEST',
      )
      expect(error).toBeTruthy()
    })
    ctx.handshake.dispose()
  })

  it('알 수 없는 mode 가 오면 무시한다', async () => {
    const ctx = await setup()
    ctx.server.push([
      { kind: 'workspace', action: 'permission_mode_changed', data: { mode: '이상한값' } },
    ])

    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(ctx.controller.current).toBe(PermissionMode.DEFAULT)
    ctx.handshake.dispose()
  })
})
