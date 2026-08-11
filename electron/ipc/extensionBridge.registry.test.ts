import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import { scanAllEnabled } from '../../tests/extensions/scanAllEnabled'
import type {
  RegistryAddPayload,
  RegistryFetchPayload,
  RegistryListPayload,
  RegistryUrlPayload,
} from '../../shared/ipc/extensionRegistryPayloads'

// 배포처 채널 핸들러. **네트워크에 붙지 않는다** — fetch 를 갈아끼운다.
//
// 이 시험이 지키는 것: 주소를 그대로 쓰는가(표준 §4.4), 오타·중복이 조용히 사라지지 않는가,
// 조회 실패가 예외가 아니라 사유로 오는가.

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

async function call<T>(channel: string, payload?: RegistryUrlPayload): Promise<T> {
  const handler = handlers.get(channel)
  if (handler === undefined) throw new Error(`${channel} 핸들러가 없습니다`)
  return (await handler(null, payload)) as T
}

const INDEX = {
  registryVersion: 1,
  name: '사내 공통 배포처',
  extensions: [
    {
      name: 'sample-ext',
      displayName: '샘플 확장',
      latest: '0.2.0',
      versions: [{ version: '0.2.0', url: 'packages/sample-ext/0.2.0' }],
    },
  ],
}

describe('배포처 채널', () => {
  let dir = ''
  let bridge: { register: () => void; dispose: () => void }
  let fetchImpl: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    handlers.clear()
    dir = await mkdtemp(join(tmpdir(), 'davis-extreg-'))

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
      views: { register: () => 'davis-ext://view/1' },
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

  it('처음에는 기억한 배포처가 없다', async () => {
    expect(await call<RegistryListPayload>(Channel.EXTENSION_REGISTRY_LIST)).toEqual({ urls: [] })
  })

  it('주소를 더하면 목록에 남는다', async () => {
    const added = await call<RegistryAddPayload>(Channel.EXTENSION_REGISTRY_ADD, {
      url: 'http://localhost:4321/index.json',
    })

    expect(added).toEqual({ ok: true, urls: ['http://localhost:4321/index.json'] })
    expect(await call<RegistryListPayload>(Channel.EXTENSION_REGISTRY_LIST)).toEqual({
      urls: ['http://localhost:4321/index.json'],
    })
  })

  // 조용히 사라지면 사용자는 오타를 냈다는 것을 알 수 없다
  it('주소가 아니면 사유를 돌려준다', async () => {
    expect(
      await call<RegistryAddPayload>(Channel.EXTENSION_REGISTRY_ADD, { url: '사내서버' }),
    ).toEqual({ ok: false, reason: 'bad_url' })
  })

  // `file:` 을 살려두면 설정 한 줄로 로컬 파일을 읽게 만들 수 있다 — 배포처는 신뢰 경계 밖이다
  it('http/https 가 아닌 주소는 거부한다', async () => {
    expect(
      await call<RegistryAddPayload>(Channel.EXTENSION_REGISTRY_ADD, {
        url: 'file:///etc/passwd',
      }),
    ).toEqual({ ok: false, reason: 'bad_url' })
  })

  it('같은 주소를 두 번 더하면 중복이라고 말한다', async () => {
    const url = 'https://axgentic.skax.local/extensions/index.json'
    await call(Channel.EXTENSION_REGISTRY_ADD, { url })

    expect(await call<RegistryAddPayload>(Channel.EXTENSION_REGISTRY_ADD, { url })).toEqual({
      ok: false,
      reason: 'duplicate',
    })
  })

  it('뺀 주소는 남지 않는다', async () => {
    const url = 'http://localhost:4321/index.json'
    await call(Channel.EXTENSION_REGISTRY_ADD, { url })

    expect(await call<RegistryListPayload>(Channel.EXTENSION_REGISTRY_REMOVE, { url })).toEqual({
      urls: [],
    })
  })

  it('없는 주소를 빼도 실패가 아니다', async () => {
    expect(
      await call<RegistryListPayload>(Channel.EXTENSION_REGISTRY_REMOVE, { url: 'http://x/i.json' }),
    ).toEqual({ urls: [] })
  })

  /**
   * 표준 §4.4 — 사용자가 넣은 것이 **목록 문서의 전체 주소**다.
   * 앱이 `/index.json` 같은 것을 덧붙이면 배포처가 그 경로를 강제당한다.
   */
  it('조회는 주소를 그대로 쓴다 — 뒤에 아무것도 덧붙이지 않는다', async () => {
    const url = 'http://localhost:4321/api/deployments/extensions'
    fetchImpl.mockResolvedValue({
      ok: true,
      url,
      text: async () => JSON.stringify(INDEX),
    })

    const result = await call<RegistryFetchPayload>(Channel.EXTENSION_REGISTRY_FETCH, { url })

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(url)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('조회에 성공해야 한다')
    expect(result.url).toBe(url)
    expect(result.index.name).toBe('사내 공통 배포처')
    // 상대경로는 문서 주소 기준으로 풀려서 온다
    expect(result.index.entries[0]?.versions[0]?.url).toBe(
      'http://localhost:4321/api/deployments/packages/sample-ext/0.2.0',
    )
  })

  it('못 닿으면 던지지 않고 사유로 온다 — 어느 배포처인지도 함께', async () => {
    const url = 'http://localhost:4321/index.json'
    fetchImpl.mockRejectedValue(new Error('connect ECONNREFUSED'))

    const result = await call<RegistryFetchPayload>(Channel.EXTENSION_REGISTRY_FETCH, { url })

    expect(result).toMatchObject({ ok: false, url, reason: 'unreachable' })
  })

  it('HTTP 오류는 못 닿는 것과 구분해서 온다', async () => {
    fetchImpl.mockResolvedValue({ ok: false, status: 404, url: '', text: async () => '' })

    const result = await call<RegistryFetchPayload>(Channel.EXTENSION_REGISTRY_FETCH, {
      url: 'http://localhost:4321/index.json',
    })

    expect(result).toMatchObject({ ok: false, reason: 'http_error', detail: 'HTTP 404' })
  })

  it('등록한 배포처 채널은 dispose 에서 전부 해제된다', () => {
    bridge.dispose()
    for (const channel of [
      Channel.EXTENSION_REGISTRY_LIST,
      Channel.EXTENSION_REGISTRY_ADD,
      Channel.EXTENSION_REGISTRY_REMOVE,
      Channel.EXTENSION_REGISTRY_FETCH,
    ]) {
      expect(handlers.has(channel)).toBe(false)
    }
    bridge.register() // afterEach 의 dispose 가 짝을 맞추게 되돌려 둔다
  })
})
