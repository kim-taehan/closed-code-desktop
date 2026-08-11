import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Channel } from '../../shared/ipc/channels'
import { SettingsStore } from '../settings/settingsStore'
import { ExtensionBridge } from './extensionBridge'

// **활성 파일 배선.** 브리지 시험에서 갈라 뒀다 — 저쪽이 300줄 상한에 닿았고,
// 여기만 `ipcMain.on`(왕복이 아닌 단방향)을 흉내 내야 해서 가짜 모양도 다르다.
//
// 이 배선은 **빠뜨려도 화면에 안 나타난다.** 확장이 받는 `null` 은 「아무것도 안 보고
// 있다」와 같은 값이라, 안 이어져 있어도 그냥 빈 화면으로 보인다. 그래서 시험으로 잠근다.

const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
const listeners = new Map<string, (event: unknown, payload?: unknown) => void>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload?: unknown) => unknown) => {
      handlers.set(channel, handler)
    },
    removeHandler: () => {},
    on: (channel: string, handler: (event: unknown, payload?: unknown) => void) => {
      listeners.set(channel, handler)
    },
    removeListener: (channel: string) => listeners.delete(channel),
  },
}))

function makeBridge() {
  const activeFiles: [unknown, string | null][] = []

  const bridge = new ExtensionBridge({
    window: { isDestroyed: () => false, webContents: { send: () => {} } } as never,
    service: {
      listExtensions: () => Promise.resolve({ extensions: [], skipped: [] }),
      runCommand: () => Promise.resolve(),
      redraw: () => Promise.resolve(),
      activeFileChanged: async (file: unknown, projectId: string | null) => {
        activeFiles.push([file, projectId])
      },
      onViewRows: () => () => {},
      onViewHtml: () => () => {},
      onViewTree: () => () => {},
      onProgress: () => () => {},
      reload: () => Promise.resolve(),
      restart: () => Promise.resolve(),
    },
    views: { register: () => 'davis-ext://view/1' },
    activeProjectId: () => '프로젝트-1',
    settings: new SettingsStore(join(tmpdir(), `davis-extactive-${process.pid}.json`)),
  })

  return { bridge, activeFiles }
}

/** 렌더러가 보낸 것처럼 채널에 흘린다. `handle` 이 아니라 `on` 이라 돌려받을 답이 없다. */
function notify(payload: unknown): void {
  listeners.get(Channel.EXTENSION_ACTIVE_FILE)?.({}, payload)
}

describe('활성 파일 배선', () => {
  beforeEach(() => {
    handlers.clear()
    listeners.clear()
  })

  it('보고 있는 파일을 확장 쪽으로 넘긴다 — 겉봉은 지금 프로젝트', () => {
    const { bridge, activeFiles } = makeBridge()
    bridge.register()

    notify({ path: 'src/A.java', line: 42 })

    expect(activeFiles).toEqual([[{ path: 'src/A.java', line: 42 }, '프로젝트-1']])
  })

  it('모양이 아닌 것은 null 로 넘긴다 — 경로 없는 파일을 지어내지 않는다', () => {
    // 빈 객체를 만들면 확장이 「경로 없는 파일」을 받는데, 그건 「안 보고 있다」와
    // 구분되지 않는다. 판정은 `extensionActiveFile.toActiveFile` 한곳에서만 한다.
    const { bridge, activeFiles } = makeBridge()
    bridge.register()

    notify({ path: '   ' })
    notify('파일이 아님')

    expect(activeFiles).toEqual([
      [null, '프로젝트-1'],
      [null, '프로젝트-1'],
    ])
  })

  it('dispose 하면 청취도 끊는다 — 창을 다시 만들 때 새지 않게', () => {
    // 회귀 잠금: `this.pushes = subscribePushes(…)` 로 **배열을 갈아끼우던** 때는
    // 여기서 넣은 해제 함수가 통째로 버려져 dispose 뒤에도 청취가 남았다.
    const { bridge } = makeBridge()
    bridge.register()
    bridge.dispose()

    expect(listeners.has(Channel.EXTENSION_ACTIVE_FILE)).toBe(false)
  })
})
