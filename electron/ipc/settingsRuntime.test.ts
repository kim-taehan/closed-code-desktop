import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import type { AppSettings } from '../../shared/settings/appSettings'

// **설정 저장은 세션을 건드리지 않는다.**
//
// 이 파일이 겨누던 것이 뒤집혔다. davis 시절엔 Admin 주소·포트·실행 방식이 설정에 있었고,
// opencode 로 옮긴 뒤에도 **서버 주소 하나**가 남아 그것이 바뀌면 여기서 세션을 전부
// 재조립했다. 지금은 그 항목이 없다 — 서버는 **프로젝트마다 앱이 띄우고**
// (`electron/opencode/serverPool.ts`) 주소는 그 프로세스가 알려 준다.
//
// 그래서 남은 계약은 둘이다: 저장이 세션을 흔들지 않는다 · 정규화된 값을 돌려준다.

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    removeHandler: () => {},
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

const BASE: AppSettings = {
  language: 'ko',
  taskDoneNotify: true,
  desktopMcp: true,
  developerMode: false,
  extensionRegistries: [],
  disabledExtensions: [],
}

describe('설정 저장', () => {
  let dir = ''

  beforeEach(async () => {
    handlers.clear()
    dir = await mkdtemp(join(tmpdir(), 'davis-set-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  async function setup(stored?: string) {
    const { ProjectBridge } = await import('./projectBridge')
    const { ProjectRegistry } = await import('../projects/projectRegistry')
    const { ProjectStore } = await import('../projects/projectStore')
    const { SettingsStore } = await import('../settings/settingsStore')
    const { BrowserWindow } = await import('electron')

    const window = new BrowserWindow() as never
    const registry = new ProjectRegistry({ store: new ProjectStore(join(dir, 'projects.json')) })
    const settingsPath = join(dir, 'settings.json')
    if (stored !== undefined) await writeFile(settingsPath, stored, 'utf8')
    const settings = new SettingsStore(settingsPath)
    const onRestartRuntime = vi.fn(() => Promise.resolve())
    const onReconnect = vi.fn(() => Promise.resolve())
    const listener = {
      onActivate: () => {},
      onClose: () => {},
      onReconnect,
      onRestartRuntime,
      activeServerUrl: () => null,
    }
    new ProjectBridge(window, registry, listener as never, settings).register()
    return { onRestartRuntime, onReconnect }
  }

  // 예전에는 `opencodeUrl` 이 바뀌면 여기서 곧바로 전부 접었다 다시 붙였다.
  // 그 항목이 없어졌으니 **저장으로 세션이 흔들릴 길도 없어야 한다.**
  it('저장해도 세션을 접었다 붙이지 않는다', async () => {
    const { onRestartRuntime, onReconnect } = await setup()
    const set = handlers.get(Channel.SETTINGS_SET)!

    await set({}, { ...BASE, taskDoneNotify: false })
    await set({}, { ...BASE, language: 'en' })

    expect(onRestartRuntime).not.toHaveBeenCalled()
    expect(onReconnect).not.toHaveBeenCalled()
  })

  it('정규화된 값을 돌려준다 — 화면이 이 값으로 다시 그린다(undefined 면 language 읽다 흰 화면)', async () => {
    await setup()
    const set = handlers.get(Channel.SETTINGS_SET)!
    const saved = await set({}, { ...BASE, language: 'en' })
    expect(saved).toMatchObject({ language: 'en' })
  })

  // 옛 설정 파일에는 아직 주소가 적혀 있다. 되돌려 주면 화면이 다시 저장해 영영 산다.
  it('설정 파일에 남은 opencodeUrl 은 조용히 버린다', async () => {
    await setup(JSON.stringify({ opencodeUrl: 'http://10.0.0.1:4096', language: 'en' }))
    const get = handlers.get(Channel.SETTINGS_GET)!

    const loaded = (await get({})) as Record<string, unknown>

    expect(loaded['opencodeUrl']).toBeUndefined()
    expect(loaded['language']).toBe('en')
  })
})
