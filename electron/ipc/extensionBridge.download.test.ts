import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import { scanAllEnabled } from '../../tests/extensions/scanAllEnabled'
import type { RegistryInstallPayload } from '../../shared/ipc/extensionRegistryPayloads'

// `extensionBridge.install.test.ts` 에서 갈라 나온 절반 — **못 받은 사유**만 본다.
// 가른 이유는 300줄 상한이다 (선례: `ScmChanges.diff.test.tsx`). 준비부는 같다.
//
// 받기(`packageDownload`)와 풀기(`install`)의 사유가 한 통로로 올라오는지가 여기 핵심이다.
// 네트워크에 붙지 않는다 — fetch 를 갈아끼운다.

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
    // 활성 파일은 handle 이 아니라 on 으로 붙는다 (`extensionActiveFile.ts`). 이 시험들이
    // 그 채널에 닿지는 않지만, 없으면 register() 자체가 터진다.
    on: () => {},
    removeListener: () => {},
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  app: { getPath: () => tmpdir() },
}))

const PACKAGE_URL = 'http://registry.local/packages/sample-ext/0.2.0'

describe('못 받은 사유가 그대로 올라온다', () => {
  let dir = ''
  let bridge: { register: () => void; dispose: () => void }
  let fetchImpl: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    handlers.clear()
    dir = await mkdtemp(join(tmpdir(), 'code-extinst-'))
    const { ExtensionBridge } = await import('./extensionBridge')
    const { SettingsStore } = await import('../settings/settingsStore')
    fetchImpl = vi.fn()
    bridge = new ExtensionBridge({
      window: {} as never,
      service: {
        listExtensions: () => scanAllEnabled(join(dir, 'desktop-extensions')),
        runCommand: () => Promise.resolve(),
        onViewRows: () => () => {},
        onViewHtml: () => () => {},
        onViewTree: () => () => {},
        onProgress: () => () => {},
        redraw: () => Promise.resolve(),
        activeFileChanged: async () => {},
    reload: () => Promise.resolve(),
        restart: () => Promise.resolve(),
      },
      views: { register: () => 'code-ext://view/1' },
      activeProjectId: () => null,
      extensionsDir: join(dir, 'desktop-extensions'),
      settings: new SettingsStore(join(dir, 'settings.json')),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    bridge.register()
  })

  afterEach(async () => {
    bridge.dispose()
    await rm(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  async function install(url = PACKAGE_URL): Promise<RegistryInstallPayload> {
    return (await handlers.get(Channel.EXTENSION_REGISTRY_INSTALL)!(null, {
      url,
    })) as RegistryInstallPayload
  }

  it('못 닿으면 unreachable', async () => {
    fetchImpl.mockRejectedValue(new Error('getaddrinfo ENOTFOUND registry.local'))
    expect(await install()).toMatchObject({ ok: false, reason: 'unreachable' })
  })

  it('4xx/5xx 는 상태코드까지', async () => {
    fetchImpl.mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })
    expect(await install()).toMatchObject({ ok: false, reason: 'http_error', detail: 'HTTP 404' })
  })

  // 화면이 넘긴 주소라도 main 이 다시 본다 — renderer 는 신뢰 경계 밖이다
  it('http/https 가 아닌 주소는 네트워크를 건드리기 전에 막는다', async () => {
    expect(await install('file:///etc/passwd')).toMatchObject({ ok: false, reason: 'bad_url' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
