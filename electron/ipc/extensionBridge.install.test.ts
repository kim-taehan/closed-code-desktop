import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import { buildZip } from '../extensions/testZip'
import { scanAllEnabled } from '../../tests/extensions/scanAllEnabled'
import type {
  RegistryInstallPayload,
  RegistryInstallRequest,
} from '../../shared/ipc/extensionRegistryPayloads'
import type { ExtensionListPayload } from '../../shared/ipc/extensionPayloads'

// 배포처에서 **내려받아 설치**하는 경로. 진짜 패키지 바이트로 전 구간을 태운다 —
// 가짜 결과를 흘려보내면 배선이 빠져도 초록이 된다.
//
// 이 시험이 지키는 것:
//  1. 배포처를 믿지 않는다 — 받은 것도 zip slip 검사와 매니페스트 검증을 **다시** 탄다
//  2. 이름·버전은 배포처 목록이 아니라 **패키지 안 매니페스트**에서 온다
//  3. 못 받은 것과 못 푼 것의 사유가 한 통로로 갈라져 올라온다
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
    manifestVersion: 2,
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

describe('배포처에서 내려받아 설치', () => {
  let dir = ''
  let extensionsDir = ''
  let bridge: { register: () => void; dispose: () => void }
  let fetchImpl: ReturnType<typeof vi.fn>
  /** 설치 성공 뒤 재훑기가 실제로 걸렸는가 (`ExtensionBridge.afterInstall`) */
  let reloads = 0
  let restarts = 0

  beforeEach(async () => {
    handlers.clear()
    dir = await mkdtemp(join(tmpdir(), 'code-extinst-'))
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
      views: { register: () => 'code-ext://view/1' },
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

  async function install(url = PACKAGE_URL): Promise<RegistryInstallPayload> {
    const handler = handlers.get(Channel.EXTENSION_REGISTRY_INSTALL)
    if (handler === undefined) throw new Error('설치 핸들러가 없습니다')
    return (await handler(null, { url } satisfies RegistryInstallRequest)) as RegistryInstallPayload
  }

  async function listInstalled(): Promise<ExtensionListPayload> {
    const handler = handlers.get(Channel.EXTENSION_LIST)!
    return (await handler(null)) as ExtensionListPayload
  }

  it('받아서 풀고, 설치 목록에 나온다', async () => {
    const zip = buildZip([
      { name: 'manifest.json', body: manifest() },
      { name: 'main.js', body: 'exports.activate = () => {}' },
    ])
    fetchImpl.mockImplementation(servePackage(zip))

    const result = await install()

    expect(result).toEqual({ ok: true, name: 'sample-ext', version: '0.2.0' })
    // 주소를 그대로 쓴다 — 뒤에 아무것도 덧붙이지 않는다
    expect(fetchImpl.mock.calls[0]![0]).toBe(PACKAGE_URL)

    const list = await listInstalled()
    expect(list.extensions).toHaveLength(1)
    expect(list.extensions[0]).toMatchObject({ name: 'sample-ext', version: '0.2.0' })
    // 푼 내용이 실제로 디스크에 있다
    expect(await readFile(join(extensionsDir, 'sample-ext', 'main.js'), 'utf8')).toContain(
      'activate',
    )
  })

  it('설치가 끝나면 재훑기를 걸고, **응답을 주기 전에** 기다린다', async () => {
    // 이것이 없으면 새 확장은 앱을 껐다 켜야 보인다 (`ExtensionService.scan` 은 한 번만 훑는다).
    // 화면은 설치 성공을 받자마자 목록을 다시 읽으므로, 응답보다 재훑기가 먼저여야 한다.
    fetchImpl.mockImplementation(
      servePackage(
        buildZip([
          { name: 'manifest.json', body: manifest() },
          { name: 'main.js', body: '' },
        ]),
      ),
    )

    expect(reloads).toBe(0)
    await install()

    expect(reloads).toBe(1)
    // 처음 설치는 자식을 갈지 않는다 — 캐시에 옛 모듈이 없어 치를 값이 아니다
    expect(restarts).toBe(0)
  })

  // 설치 폴더 이름을 정하는 것이 매니페스트라, 둘이 어긋나면 매니페스트가 사실이다
  it('이름·버전은 배포처가 아니라 패키지 매니페스트에서 온다', async () => {
    const zip = buildZip([
      { name: 'manifest.json', body: manifest({ name: 'other-name', version: '9.9.9' }) },
      { name: 'main.js', body: '' },
    ])
    fetchImpl.mockImplementation(servePackage(zip))

    expect(await install()).toEqual({ ok: true, name: 'other-name', version: '9.9.9' })
    expect((await listInstalled()).extensions[0]).toMatchObject({ name: 'other-name' })
  })

  it('같은 이름을 다시 받으면 덮어쓴다 — 이것이 곧 업데이트다', async () => {
    fetchImpl.mockImplementation(
      servePackage(
        buildZip([
          { name: 'manifest.json', body: manifest() },
          { name: 'main.js', body: '' },
        ]),
      ),
    )
    await install()

    fetchImpl.mockImplementation(
      servePackage(
        buildZip([
          { name: 'manifest.json', body: manifest({ version: '0.3.0' }) },
          { name: 'main.js', body: '' },
        ]),
      ),
    )
    expect(await install()).toMatchObject({ ok: true, version: '0.3.0' })

    const list = await listInstalled()
    expect(list.extensions).toHaveLength(1)
    expect(list.extensions[0]).toMatchObject({ version: '0.3.0' })

    // 덮어쓴 코드는 **새 자식에서만** 실린다 — 자식의 require 캐시가 옛 모듈을 돌려주므로
    // 재훑기만 하면 목록의 버전은 올라가고 동작은 옛것으로 남는다.
    // 처음 설치(캐시에 없다)는 그 값을 치를 이유가 없어 재훑기로 끝낸다.
    expect(restarts).toBe(1)
    expect(reloads).toBe(1)
  })
})
