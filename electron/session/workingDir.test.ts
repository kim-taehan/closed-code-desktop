import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryConnection } from '../../tests/fake-runtime/MemoryConnection'
import { Handshake } from './handshake'
import {
  WORKING_DIR_INACTIVE,
  WorkingDirController,
  parseWorkingDirState,
  type WorkingDirState,
} from './workingDir'

// 현재 세션 작업 경로 push (ADR-036 / DC-1146).

let connection: MemoryConnection | null = null

afterEach(() => {
  connection?.dispose()
  connection = null
})

async function setup() {
  connection = new MemoryConnection()
  const server = connection.runtime

  const controller = new WorkingDirController(connection)
  const seen: WorkingDirState[] = []
  controller.onChange((state) => seen.push(state))
  controller.start()

  const handshake = new Handshake(connection, { workspacePath: '/tmp' })
  const ready = handshake.run()
  await connection.connect()
  await ready

  return { controller, seen, handshake, server, connection: connection! }
}

/** IDE 계약 골든 픽스처와 같은 모양 (vscode: workspace.working_dir_state.s2c.json). */
const EXTERNAL_PUSH = {
  kind: 'workspace',
  action: 'working_dir_state',
  data: {
    active: true,
    kind: 'external',
    path: '/home/fixture/external-docs',
    projectName: 'external:external-docs',
  },
}

describe('working_dir_state 파싱', () => {
  it('active 가 boolean 이 아니면 프레임을 버린다 — 켜짐/꺼짐을 모르면 그릴 수 없다', () => {
    expect(parseWorkingDirState(undefined)).toBeNull()
    expect(parseWorkingDirState({})).toBeNull()
    expect(parseWorkingDirState({ active: 'true' })).toBeNull()
  })

  it('active=false 면 override 없음으로 본다', () => {
    expect(parseWorkingDirState({ active: false, path: '/x' })).toEqual(WORKING_DIR_INACTIVE)
  })

  it('active 인데 경로가 없으면 꺼진 것으로 본다 — 빈 칩을 띄우지 않는다', () => {
    expect(parseWorkingDirState({ active: true })).toEqual(WORKING_DIR_INACTIVE)
    expect(parseWorkingDirState({ active: true, path: '' })).toEqual(WORKING_DIR_INACTIVE)
  })

  it('external 페이로드를 그대로 읽는다', () => {
    expect(parseWorkingDirState(EXTERNAL_PUSH.data)).toEqual({
      active: true,
      kind: 'external',
      path: '/home/fixture/external-docs',
      projectName: 'external:external-docs',
    })
  })

  it('선택 필드가 없으면 키 자체를 만들지 않는다', () => {
    const parsed = parseWorkingDirState({ active: true, path: '/w' })
    expect(parsed).toEqual({ active: true, path: '/w' })
    expect('kind' in (parsed as object)).toBe(false)
    expect('projectName' in (parsed as object)).toBe(false)
  })
})

describe('작업 경로 수신', () => {
  it('기본은 override 없음이다', async () => {
    const ctx = await setup()
    expect(ctx.controller.current).toEqual(WORKING_DIR_INACTIVE)
    ctx.handshake.dispose()
  })

  it('push 를 받으면 현재 경로가 바뀌고 구독자에게 알린다', async () => {
    const ctx = await setup()
    ctx.server.push([EXTERNAL_PUSH])

    await vi.waitFor(() => expect(ctx.controller.current.active).toBe(true))
    expect(ctx.controller.current.path).toBe('/home/fixture/external-docs')
    expect(ctx.seen.at(-1)?.projectName).toBe('external:external-docs')
    ctx.handshake.dispose()
  })

  it('같은 상태가 다시 오면 알리지 않는다 — 상태바가 헛되이 깜빡이지 않도록', async () => {
    const ctx = await setup()
    ctx.server.push([EXTERNAL_PUSH])
    await vi.waitFor(() => expect(ctx.seen).toHaveLength(1))

    ctx.server.push([EXTERNAL_PUSH])
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ctx.seen).toHaveLength(1)
    ctx.handshake.dispose()
  })

  it('active=false 가 오면 원래 경로로 돌아온다', async () => {
    const ctx = await setup()
    ctx.server.push([EXTERNAL_PUSH])
    await vi.waitFor(() => expect(ctx.controller.current.active).toBe(true))

    ctx.server.push([{ kind: 'workspace', action: 'working_dir_state', data: { active: false } }])
    await vi.waitFor(() => expect(ctx.controller.current).toEqual(WORKING_DIR_INACTIVE))
    ctx.handshake.dispose()
  })

  it('다른 kind/action 은 무시한다', async () => {
    const ctx = await setup()
    ctx.server.push([
      { kind: 'chat', action: 'working_dir_state', data: { active: true, path: '/x' } },
      { kind: 'workspace', action: 'permission_mode_changed', data: { mode: 'plan' } },
    ])

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ctx.controller.current).toEqual(WORKING_DIR_INACTIVE)
    ctx.handshake.dispose()
  })

  it('reset 하면 꺼진 상태로 되돌린다 — 재연결 시 옛 경로를 남기지 않는다', async () => {
    const ctx = await setup()
    ctx.server.push([EXTERNAL_PUSH])
    await vi.waitFor(() => expect(ctx.controller.current.active).toBe(true))

    ctx.controller.reset()
    expect(ctx.controller.current).toEqual(WORKING_DIR_INACTIVE)
    expect(ctx.seen.at(-1)).toEqual(WORKING_DIR_INACTIVE)
    ctx.handshake.dispose()
  })

  it('stop 이후에는 알리지 않는다', async () => {
    const ctx = await setup()
    ctx.controller.stop()
    ctx.server.push([EXTERNAL_PUSH])

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ctx.seen).toHaveLength(0)
    ctx.handshake.dispose()
  })
})
