import { readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'

// IPC 배선 검사.
//
// **왜 필요한가**: 채널 하나를 붙이려면 네 파일을 고쳐야 한다
// (channels.ts → desktopBridge.ts → preload.ts → 핸들러). 타입체크는
// 앞의 셋만 묶어 주고 **마지막 하나가 빠진 것은 못 잡는다** — renderer 가
// invoke 를 부를 때에야 "handler 가 없다" 로 터진다. 실제로 그렇게 터졌다.
//
// 그리고 등록한 채널을 HANDLED_CHANNELS 에 안 적으면 창을 다시 만들 때
// 핸들러가 샌다. 이것도 돌려 보기 전에는 아무도 모른다.

const registered = new Set<string>()
const removed = new Set<string>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string) => registered.add(channel),
    removeHandler: (channel: string) => removed.add(channel),
    // 활성 파일은 handle 이 아니라 on 으로 붙는다 (`extensionActiveFile.ts`). 이 시험들이
    // 그 채널에 닿지는 않지만, 없으면 register() 자체가 터진다.
    on: () => {},
    removeListener: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() {
      return []
    }
    isDestroyed() {
      return true
    }
    webContents = { send: () => {} }
  },
  app: { getPath: () => tmpdir() },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
}))

/**
 * preload 가 실제로 invoke 하는 채널. 소스를 읽어 뽑는다 — 배선의 사실이 거기 있다.
 *
 * `preload*.ts` 를 **전부** 훑는다. preload.ts 하나만 읽던 시절에 git 배선을
 * preloadGit.ts 로 떼자 검사가 그 채널들을 조용히 놓치면서 초록이 됐다 —
 * 배선을 또 가를 때도 파일이 스캔에서 빠지지 않게 이름으로 모은다.
 */
function invokedChannels(): string[] {
  const dir = join(__dirname, '..')
  const source = readdirSync(dir)
    .filter((name) => /^preload.*\.ts$/.test(name))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n')
  const names = [...source.matchAll(/ipcRenderer\.invoke\(Channel\.(\w+)/g)].map((match) => match[1]!)
  return [...new Set(names)]
}

describe('IPC 배선', () => {
  let dir = ''

  beforeEach(async () => {
    registered.clear()
    removed.clear()
    dir = await mkdtemp(join(tmpdir(), 'davis-wiring-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  async function registerAll(): Promise<{ dispose: () => Promise<void> }> {
    const { SessionBridge } = await import('./bridge')
    const { ProjectBridge } = await import('./projectBridge')
    const { LogBridge } = await import('./logBridge')
    const { GitBridge } = await import('./gitBridge')
    const { ExtensionBridge } = await import('./extensionBridge')
    const { PtyDrawerBridge } = await import('../pty/drawerBridge')
    const { ProjectRegistry } = await import('../projects/projectRegistry')
    const { ProjectStore } = await import('../projects/projectStore')
    const { SettingsStore } = await import('../settings/settingsStore')
    const { BrowserWindow } = await import('electron')

    const window = new BrowserWindow() as never
    const registry = new ProjectRegistry({ store: new ProjectStore(join(dir, 'projects.json')) })
    const settings = new SettingsStore(join(dir, 'settings.json'))

    const session = new SessionBridge(window, {})
    const projects = new ProjectBridge(
      window,
      registry,
      {
        onActivate: () => {},
        onClose: () => {},
        onReconnect: async () => {},
        onRestartRuntime: () => Promise.resolve(),
        onRuntimeConfigChange: () => Promise.resolve(),
      },
      settings,
    )
    const logs = new LogBridge()
    const git = new GitBridge(window, registry)
    // 확장 호스트는 utilityProcess 를 띄우므로 여기서는 가짜를 끼운다 —
    // 이 테스트가 보는 것은 채널 등록/해제이지 확장 로딩이 아니다.
    // 설치 폴더도 임시 디렉토리로 돌린다 — 시험이 사용자 홈을 훑으면 안 된다.
    const extensions = new ExtensionBridge({
      window,
      service: {
        listExtensions: () => Promise.resolve({ extensions: [], skipped: [] }),
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
      settings,
    })

    // 셸 드로어. 서버에 닿지 않는다 — 이 시험이 보는 것은 채널 등록/해제뿐이다.
    const drawer = new PtyDrawerBridge({
      window,
      activeProject: () => null,
      opencodeUrl: () => Promise.resolve('http://127.0.0.1:4096'),
    })

    session.register()
    projects.register()
    logs.register()
    git.register()
    extensions.register()
    drawer.register()

    return {
      dispose: async () => {
        await session.dispose()
        projects.dispose()
        logs.dispose()
        git.dispose()
        extensions.dispose()
        await drawer.dispose()
      },
    }
  }

  it('preload 가 부르는 채널에는 모두 핸들러가 있다', async () => {
    await registerAll()

    const missing = invokedChannels().filter((name) => {
      const channel = channelValue(name)
      return !registered.has(channel)
    })

    expect(missing).toEqual([])
  })

  it('등록한 채널은 dispose 에서 전부 해제된다 — 창을 다시 만들 때 새지 않게', async () => {
    const { dispose } = await registerAll()
    const opened = [...registered]
    await dispose()

    const leaked = opened.filter((channel) => !removed.has(channel))
    expect(leaked).toEqual([])
  })

  it('별 파일로 뗀 배선(preloadGit.ts)도 스캔에 잡힌다 — 검사가 조용히 좁아지지 않게', () => {
    // preload.ts 하나만 읽던 시절이면 여기서 떨어진다. 위 두 케이스는 "못 본 채널"을
    // 통과로 셈하므로, 스캔 범위가 좁아진 것은 이 케이스로만 드러난다.
    expect(invokedChannels()).toContain('GIT_STAGE')
  })
})

/** `LOG_LIST` 같은 상수 이름 → `'log:list'` 실제 값 */
function channelValue(name: string): string {
  const value = (Channel as Record<string, string>)[name]
  if (value === undefined) throw new Error(`Channel.${name} 이 없습니다`)
  return value
}
