import { beforeEach, describe, expect, it, vi } from 'vitest'

// **떠나는 쪽이 자기 신원을 말하는가.**
//
// 이 프레임이 나가는 유일한 경로가 프로젝트 전환인데, 그 시점에 main 의 활성 프로젝트는
// **이미 도착한 쪽**이다. 활성으로 풀면 떠나온 A 대신 도착한 B 를 정리하고, **A 의 WS 는
// 안 닫힌 채 표에 남는다** — 옮겨 다닐수록 쌓인다 (design-audit 경고 2).
// 겉봉 필터 덕에 화면 유출은 없어서, 증상이 오래 안 보이는 종류다.

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const listeners = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => unknown) => listeners.set(channel, fn),
    removeHandler: (channel: string) => handlers.delete(channel),
    removeListener: (channel: string) => listeners.delete(channel),
  },
}))

const A = { id: 'A', root: '/tmp/projA' }
const B = { id: 'B', root: '/tmp/projB' }

/** 열린 소켓 흉내 — 닫혔는지만 본다 */
const closed: string[] = []

vi.mock('./socket', () => ({
  PtySocket: class {
    constructor(private readonly options: { url: string }) {}
    onData(): void {}
    onControl(): void {}
    onClose(): void {}
    onError(): void {}
    open(): void {}
    write(): boolean {
      return true
    }
    close(): void {
      closed.push(this.options.url)
    }
  },
}))

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return {
    ...actual,
    PtyClient: class {
      readonly headers = {}
      list(): Promise<unknown[]> {
        return Promise.resolve([])
      }
      create(directory: string): Promise<{ id: string }> {
        return Promise.resolve({ id: `pty_${directory.slice(-1)}` })
      }
      socketUrl(_directory: string, ptyId: string): string {
        return `ws://fake/${ptyId}`
      }
      get(): Promise<null> {
        return Promise.resolve(null)
      }
      resize(): Promise<void> {
        return Promise.resolve()
      }
      remove(): Promise<void> {
        return Promise.resolve()
      }
    },
  }
})

describe('PtyDrawerBridge — 떠날 때의 신원', () => {
  let active: { id: string; root: string } | null = A

  beforeEach(() => {
    handlers.clear()
    listeners.clear()
    closed.length = 0
    active = A
  })

  async function setup() {
    const { PtyDrawerBridge } = await import('./drawerBridge')
    const bridge = new PtyDrawerBridge({
      window: { isDestroyed: () => false, webContents: { send: () => {} } } as never,
      activeProject: () => active,
      opencodeUrl: () => Promise.resolve('http://127.0.0.1:4096'),
    })
    bridge.register()
    return bridge
  }

  it('프로젝트를 옮긴 뒤에도 떠나온 쪽의 소켓을 닫는다', async () => {
    const bridge = await setup()

    // A 에서 드로어를 연다
    await handlers.get('pty:open')!()
    expect(closed).toEqual([])

    // 사용자가 B 로 옮긴다 — main 의 활성은 **이미** B 다
    active = B
    // 그 뒤에야 A 의 정리 함수가 돌아 detach 가 도착한다
    listeners.get('pty:detach')!({}, { projectId: 'A' })

    expect(closed).toEqual(['ws://fake/pty_A'])
    await bridge.dispose()
  })

  // 신원을 안 실으면 이 케이스가 A 대신 B 를 닫았다. 지금은 B 를 건드리면 안 된다.
  it('도착한 쪽의 드로어는 건드리지 않는다', async () => {
    const bridge = await setup()
    await handlers.get('pty:open')!()

    active = B
    await handlers.get('pty:open')!() // B 도 연다
    closed.length = 0

    listeners.get('pty:detach')!({}, { projectId: 'A' })

    expect(closed).toEqual(['ws://fake/pty_A'])
    await bridge.dispose()
  })

  it('신원이 없는 프레임은 아무것도 정리하지 않는다', async () => {
    const bridge = await setup()
    await handlers.get('pty:open')!()

    listeners.get('pty:detach')!({}, {})

    expect(closed).toEqual([])
    await bridge.dispose()
  })
})
