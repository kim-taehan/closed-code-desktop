import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import { DEFAULT_OPENCODE_URL, type AppSettings } from '../../shared/settings/appSettings'

// 설정탭에서 opencode 서버 주소를 바꾸면 **앱 재시작 없이** 그 주소로 다시 붙어야 한다.
//
// davis 시절엔 여기서 Admin 주소·포트·실행 방식 셋을 봤고, 값이 채워져야 비로소
// installer 가 생겨 런타임을 받았다. opencode 는 사용자가 띄운 서버에 붙기만 하므로
// **주소 하나가 설정의 전부**다 — 그것만 바뀌었는지 보고 재조립한다.

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
  opencodeUrl: DEFAULT_OPENCODE_URL,
  language: 'ko',
  taskDoneNotify: true,
  desktopMcp: true,
  developerMode: false,
  extensionRegistries: [],
  disabledExtensions: [],
}

describe('설정 저장 → 세션 재조립', () => {
  let dir = ''

  beforeEach(async () => {
    handlers.clear()
    dir = await mkdtemp(join(tmpdir(), 'davis-set-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  async function setup() {
    const { ProjectBridge } = await import('./projectBridge')
    const { ProjectRegistry } = await import('../projects/projectRegistry')
    const { ProjectStore } = await import('../projects/projectStore')
    const { SettingsStore } = await import('../settings/settingsStore')
    const { BrowserWindow } = await import('electron')

    const window = new BrowserWindow() as never
    const registry = new ProjectRegistry({ store: new ProjectStore(join(dir, 'projects.json')) })
    const settings = new SettingsStore(join(dir, 'settings.json'))
    const onRuntimeConfigChange = vi.fn(
      (_runtime: { opencodeUrl: string }, _projects: unknown[]) => Promise.resolve(),
    )
    const listener = {
      onActivate: () => {},
      onClose: () => {},
      onReconnect: () => {},
      onRestartRuntime: () => Promise.resolve(),
      onRuntimeConfigChange,
    }
    new ProjectBridge(window, registry, listener as never, settings).register()
    return { onRuntimeConfigChange }
  }

  it('opencodeUrl 이 바뀌면 새 주소로 onRuntimeConfigChange 를 부른다', async () => {
    const { onRuntimeConfigChange } = await setup()
    const set = handlers.get(Channel.SETTINGS_SET)!
    await set({}, { ...BASE, opencodeUrl: 'http://10.0.0.1:4096' })

    expect(onRuntimeConfigChange).toHaveBeenCalledOnce()
    expect(onRuntimeConfigChange.mock.calls[0]![0]).toEqual({ opencodeUrl: 'http://10.0.0.1:4096' })
  })

  it('주소와 무관한 값(알림 토글)만 바뀌면 부르지 않는다 — 멀쩡한 세션을 끊지 않는다', async () => {
    const { onRuntimeConfigChange } = await setup()
    const set = handlers.get(Channel.SETTINGS_SET)!
    await set({}, { ...BASE, taskDoneNotify: false })

    expect(onRuntimeConfigChange).not.toHaveBeenCalled()
  })

  it('저장하면 정규화된 값을 돌려준다 — 화면이 이 값으로 다시 그린다(undefined 면 language 읽다 흰 화면)', async () => {
    await setup()
    const set = handlers.get(Channel.SETTINGS_SET)!
    // 언어 변경 저장 경로. 반환이 없으면 renderer 가 value=undefined 로 죽는다.
    const saved = await set({}, { ...BASE, language: 'en' })
    expect(saved).toBeDefined()
    expect(saved).toMatchObject({ language: 'en', opencodeUrl: BASE.opencodeUrl })
  })
})
