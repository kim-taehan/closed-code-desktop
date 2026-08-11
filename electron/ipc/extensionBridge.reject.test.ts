import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import { buildZip } from '../extensions/testZip'
import { scanAllEnabled } from '../../tests/extensions/scanAllEnabled'
import type { RegistryInstallPayload } from '../../shared/ipc/extensionRegistryPayloads'

// 배포처에서 받은 것을 **거부하는** 경로. 성공 경로는 `extensionBridge.install.test.ts`
// 가 보고, 여기서는 받은 것을 믿지 않는 자리만 본다 (300줄 상한으로 갈랐다).
//
// **배포처는 신뢰 경계 밖이다.** 받은 것도 디스크 설치와 똑같이 zip slip 검사와
// 매니페스트 검증을 다시 타야 하고, 못 받은 것과 못 푼 것의 사유가 갈라져 올라와야 한다.
//
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

function manifest(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    manifestVersion: 1,
    name: 'sample-ext',
    displayName: '샘플 확장',
    version: '0.2.0',
    main: 'main.js',
    ...patch,
  })
}

/** 성공 응답 하나. 압축 바이트를 그대로 준다 (표준 §4.4 "패키지 바이트를 그대로") */
function servePackage(zip: Buffer) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
  }))
}

describe('배포처를 믿지 않는다', () => {
  let dir = ''
  let extensionsDir = ''
  let bridge: { register: () => void; dispose: () => void }
  let fetchImpl: ReturnType<typeof vi.fn>
  /** 설치 성공 뒤 재훑기가 실제로 걸렸는가 (`ExtensionBridge.afterInstall`) */
  let reloads = 0
  let restarts = 0

  beforeEach(async () => {
    handlers.clear()
    dir = await mkdtemp(join(tmpdir(), 'davis-extinst-'))
    extensionsDir = join(dir, 'desktop-extensions')
    const { ExtensionBridge } = await import('./extensionBridge')
    const { SettingsStore } = await import('../settings/settingsStore')
    fetchImpl = vi.fn()
    reloads = 0
    bridge = new ExtensionBridge({
      window: {} as never,
      // 목록은 서비스가 맡는다. 여기서는 **실제 훑기**에 이어 붙인다 —
      // 이 시험이 EXTENSION_LIST 로 확인하는 것이 "패키지가 디스크에 안착했나" 라서,
      // 빈손 가짜를 끼우면 검증이 사라진다. 확장을 싣지는 않으므로 훑기까지만이다.
      service: {
        listExtensions: () => scanAllEnabled(extensionsDir),
        runCommand: () => Promise.resolve(),
        onViewRows: () => () => {},
        onViewHtml: () => () => {},
        onViewTree: () => () => {},
        onProgress: () => () => {},
        redraw: () => Promise.resolve(),
        activeFileChanged: async () => {},
        reload: () => {
          reloads += 1
          return Promise.resolve()
        },
        restart: () => {
          restarts += 1
          return Promise.resolve()
        },
      },
      views: { register: () => 'davis-ext://view/1' },
      activeProjectId: () => null,
      extensionsDir,
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

  async function install(): Promise<RegistryInstallPayload> {
    return (await handlers.get(Channel.EXTENSION_REGISTRY_INSTALL)!(null, {
      url: PACKAGE_URL,
    })) as RegistryInstallPayload
  }

  // 사내 배포처라도 그 안의 패키지는 누가 올렸는지 모른다 (표준 §4.4)
  it('설치 폴더 밖을 가리키는 패키지는 거부한다 — zip slip 검사를 다시 탄다', async () => {
    fetchImpl.mockImplementation(
      servePackage(
        buildZip([
          { name: 'manifest.json', body: manifest() },
          { name: '../../evil.js', body: 'gotcha' },
        ]),
      ),
    )

    const result = await install()

    expect(result).toMatchObject({ ok: false, reason: 'unsafe_entry' })
    expect((result as { detail?: string }).detail).toContain('..')
  })

  it('매니페스트가 없는 패키지는 거부한다', async () => {
    fetchImpl.mockImplementation(servePackage(buildZip([{ name: 'main.js', body: '' }])))
    expect(await install()).toMatchObject({ ok: false, reason: 'no_manifest' })
  })

  it('매니페스트가 규격에 안 맞으면 사유를 함께 준다', async () => {
    fetchImpl.mockImplementation(
      servePackage(
        buildZip([{ name: 'manifest.json', body: JSON.stringify({ name: 'x' }) }]),
      ),
    )
    expect(await install()).toMatchObject({
      ok: false,
      reason: 'invalid_manifest',
      detail: 'missing_manifest_version',
    })
  })

  it('압축이 아니면 거부한다', async () => {
    fetchImpl.mockImplementation(servePackage(Buffer.from('<html>로그인 하세요</html>')))
    expect(await install()).toMatchObject({ ok: false, reason: 'unreadable_package' })
  })

  it('거부한 설치는 재훑기를 걸지 않는다 — 디스크가 안 바뀌었다', async () => {
    fetchImpl.mockImplementation(servePackage(Buffer.from('<html>로그인 하세요</html>')))

    await install()

    expect(reloads).toBe(0)
  })
})
