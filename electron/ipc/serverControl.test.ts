import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import { FakeOpencodeServer } from '../../tests/fake-opencode/FakeOpencodeServer'
import type { ServerControlResultPayload } from '../../shared/ipc/diagnosticsTypes'

// **`server:control` 의 성공 판정** — 「무엇을 성공이라 부르나」 한 자리.
//
// ⭐ 판정이 `statusOf().running` 이었다: **우리 표에 있나.** 그런데 표는 자식의 죽음을
// 뒤늦게 안다 — 자식을 SIGKILL 한 직후에는 `running` 이 참인 채로 **죽은 주소**를 가리킨다
// (실측 2026-08-16, contract-qa). 그 창에서 조작이 아무 일도 안 하고 돌아와도 이 자리는
// `ok:true` 를 냈고, Doctor 사다리는 그것을 성공으로 적은 뒤 "서버가 떴습니다(죽은 주소)"
// 를 화면에 실었다. **조용히 통과하는 무동작 성공**이 그 모양이다.
//
// 지금 묻는 것은 하나다: **그 주소가 지금 응답하나.**

const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload?: unknown) => unknown) =>
      handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
    on: () => {},
    removeListener: () => {},
  },
  BrowserWindow: class {
    isDestroyed() {
      return true
    }
    webContents = { send: () => {} }
  },
  app: { getPath: () => tmpdir() },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
}))

let server: FakeOpencodeServer
let dir = ''

beforeEach(async () => {
  handlers.clear()
  server = new FakeOpencodeServer()
  await server.start()
  dir = await mkdtemp(join(tmpdir(), 'server-control-'))
})

afterEach(async () => {
  await server.stop()
  await rm(dir, { recursive: true, force: true })
  vi.resetModules()
})

/**
 * 핸들러 하나만 세운다.
 *
 * `serverUrl` 과 `serverStatus` 를 **따로** 준다 — 이 시험의 전부가 그 둘이 어긋나는
 * 순간이기 때문이다 (표는 살아 있다고 하는데 주소는 죽었다).
 */
async function control(over: { serverUrl: string | null; running: boolean }) {
  const { ProjectBridge } = await import('./projectBridge')
  const { ProjectRegistry } = await import('../projects/projectRegistry')
  const { ProjectStore } = await import('../projects/projectStore')
  const { SettingsStore } = await import('../settings/settingsStore')
  const { BrowserWindow } = await import('electron')

  const registry = new ProjectRegistry({ store: new ProjectStore(join(dir, 'projects.json')) })
  await registry.open(dir)
  const bridge = new ProjectBridge(
    new BrowserWindow() as never,
    registry,
    {
      onActivate: () => {},
      onClose: () => {},
      onReconnect: async () => {},
      onRestartRuntime: () => Promise.resolve(),
      activeServerUrl: () => over.serverUrl,
      serverStatus: () => ({
        running: over.running,
        url: over.serverUrl,
        pid: over.running ? 4242 : null,
        ours: over.running,
      }),
      // 조작 자체는 아무 일도 안 한다 — **판정만** 보는 시험이다
      onServerControl: () => Promise.resolve(),
    },
    new SettingsStore(join(dir, 'settings.json')),
  )
  bridge.register()
  const handler = handlers.get(Channel.SERVER_CONTROL)!
  return (action: 'start' | 'restart' | 'stop') =>
    handler({}, { action }) as Promise<ServerControlResultPayload>
}

describe('server:control — 응답해야 성공이다', () => {
  it('서버가 응답하면 성공이다', async () => {
    const run = await control({ serverUrl: server.baseUrl, running: true })
    expect(await run('restart')).toMatchObject({ ok: true })
  })

  // ⭐⭐ **여기가 무동작 성공이 조용히 통과하던 자리다.**
  // 표는 아직 살아 있다고 하는데(`running: true`) 그 주소는 죽었다.
  it('표는 살아 있다는데 주소가 죽었으면 실패다', async () => {
    await server.stop()
    const run = await control({ serverUrl: server.baseUrl, running: true })
    const result = await run('restart')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('응답하지 않습니다')
    // 표의 값은 그대로 실어 보낸다 — 화면이 어긋남을 볼 수 있어야 한다
    expect(result.status.running).toBe(true)
  })

  it('띄울 주소조차 없으면 실패다', async () => {
    const run = await control({ serverUrl: null, running: false })
    expect(await run('start')).toMatchObject({ ok: false })
  })

  // 끄는 조작은 **응답하지 않아야** 맞다 — 여기에 health 를 걸면 성공이 영영 안 난다
  it('stop 은 health 를 묻지 않는다', async () => {
    await server.stop()
    const run = await control({ serverUrl: server.baseUrl, running: false })
    expect(await run('stop')).toMatchObject({ ok: true })
  })
})
