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

/** 소켓 흉내 — 닫혔는지, 무엇을 썼는지를 본다 */
const closed: string[] = []

interface FakeSocket {
  opened: boolean
  readonly sent: string[]
  /** 핸드셰이크가 끝났다고 알린다. **저절로 되지 않는다** — 실물도 그렇다 */
  fireOpen(): void
}

/** url(=pty 하나) 로 찾는다. 프로젝트 둘을 열면 둘이 생긴다 */
const sockets = new Map<string, FakeSocket>()

// **열리기 전에는 쓰지 못한다** — 실물이 그렇다 (`socket.ts` 의 실측). 여기서 그냥 받아
// 주면 "맡아 뒀다 열릴 때 넣는다" 는 규칙이 없어도 초록이 나온다.
vi.mock('./socket', () => ({
  PtySocket: class {
    opened = false
    readonly sent: string[] = []
    private openHandler: () => void = () => {}

    constructor(private readonly options: { url: string }) {
      sockets.set(options.url, this)
    }
    onData(): void {}
    onControl(): void {}
    onClose(): void {}
    onError(): void {}
    onOpen(handler: () => void): void {
      this.openHandler = handler
    }
    open(): void {}
    fireOpen(): void {
      this.opened = true
      this.openHandler()
    }
    write(data: string): boolean {
      if (!this.opened) return false
      this.sent.push(data)
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
    sockets.clear()
    active = A
  })

  async function setup() {
    const { PtyDrawerBridge } = await import('./drawerBridge')
    const bridge = new PtyDrawerBridge({
      window: { isDestroyed: () => false, webContents: { send: () => {} } } as never,
      activeProject: () => active,
      opencodeUrl: () => 'http://127.0.0.1:4096',
    })
    bridge.register()
    return bridge
  }

  it('프로젝트를 옮긴 뒤에도 떠나온 쪽의 소켓을 닫는다', async () => {
    const bridge = await setup()

    // A 에서 드로어를 연다
    await handlers.get('pty:open')!({}, { name: 'shell' })
    expect(closed).toEqual([])

    // 사용자가 B 로 옮긴다 — main 의 활성은 **이미** B 다
    active = B
    // 그 뒤에야 A 의 정리 함수가 돌아 detach 가 도착한다
    listeners.get('pty:detach')!({}, { projectId: 'A', name: 'shell' })

    expect(closed).toEqual(['ws://fake/pty_A'])
    await bridge.dispose()
  })

  // 신원을 안 실으면 이 케이스가 A 대신 B 를 닫았다. 지금은 B 를 건드리면 안 된다.
  it('도착한 쪽의 드로어는 건드리지 않는다', async () => {
    const bridge = await setup()
    await handlers.get('pty:open')!({}, { name: 'shell' })

    active = B
    await handlers.get('pty:open')!({}, { name: 'shell' }) // B 도 연다
    closed.length = 0

    listeners.get('pty:detach')!({}, { projectId: 'A', name: 'shell' })

    expect(closed).toEqual(['ws://fake/pty_A'])
    await bridge.dispose()
  })

  it('신원이 없는 프레임은 아무것도 정리하지 않는다', async () => {
    const bridge = await setup()
    await handlers.get('pty:open')!({}, { name: 'shell' })

    listeners.get('pty:detach')!({}, {})

    expect(closed).toEqual([])
    await bridge.dispose()
  })
})

// **채우기는 소켓이 열린 뒤에만 가능하다.** 에이전트가 부르는 시점에 칸은 한 번도 안
// 펴져 있을 수 있고, 그러면 pty 는 화면이 칸을 그린 뒤에야 붙는다. 그 전에 쓴 바이트는
// 아무 흔적 없이 사라진다 — 화면에도, 모델에게도, 로그에도 안 남는 종류의 실패다.
describe('PtyDrawerBridge — 채워 두기', () => {
  let active: { id: string; root: string } | null = A

  beforeEach(() => {
    handlers.clear()
    listeners.clear()
    closed.length = 0
    sockets.clear()
    active = A
  })

  async function setup() {
    const { PtyDrawerBridge } = await import('./drawerBridge')
    const bridge = new PtyDrawerBridge({
      window: { isDestroyed: () => false, webContents: { send: () => {} } } as never,
      activeProject: () => active,
      opencodeUrl: () => 'http://127.0.0.1:4096',
    })
    bridge.register()
    return bridge
  }

  /** 줄을 비우는 앞머리 (Ctrl+E · Ctrl+U) + 명령. **개행은 없다** — 실행되면 안 된다 */
  const filled = (command: string) => `\u0005\u0015${command}`

  it('칸이 한 번도 안 펴졌으면 맡아 뒀다가 소켓이 열릴 때 넣는다', async () => {
    const bridge = await setup()
    bridge.fill('A', 'npm test')
    // 아직 pty 가 없다 — 여기서 그냥 쓰면 사라진다
    expect(sockets.size).toBe(0)

    await handlers.get('pty:open')!({}, { name: 'shell' })
    const socket = sockets.get('ws://fake/pty_A')!
    // 붙는 중(CONNECTING)이라 아직 못 쓴다
    expect(socket.sent).toEqual([])

    socket.fireOpen()
    expect(socket.sent).toEqual([filled('npm test')])
    await bridge.dispose()
  })

  it('이미 열려 있으면 그 자리에서 넣는다', async () => {
    const bridge = await setup()
    await handlers.get('pty:open')!({}, { name: 'shell' })
    const socket = sockets.get('ws://fake/pty_A')!
    socket.fireOpen()

    bridge.fill('A', 'ls -al')
    expect(socket.sent).toEqual([filled('ls -al')])
    await bridge.dispose()
  })

  // 개행이 붙으면 사용자가 보기도 전에 돌아간다 — 이 도구의 값이 통째로 사라진다
  it('개행을 붙이지 않는다', async () => {
    const bridge = await setup()
    await handlers.get('pty:open')!({}, { name: 'shell' })
    const socket = sockets.get('ws://fake/pty_A')!
    socket.fireOpen()

    bridge.fill('A', 'rm -rf build')
    expect(socket.sent.join('')).not.toContain('\n')
    expect(socket.sent.join('')).not.toContain('\r')
    await bridge.dispose()
  })

  // 맡아 둔 것이 남의 칸으로 가면 그게 유출이다 — 키는 프로젝트다
  it('맡아 둔 명령은 그 프로젝트의 칸에만 들어간다', async () => {
    const bridge = await setup()
    bridge.fill('A', 'A 의 명령')

    active = B
    await handlers.get('pty:open')!({}, { name: 'shell' })
    const b = sockets.get('ws://fake/pty_B')!
    b.fireOpen()

    expect(b.sent).toEqual([])
    await bridge.dispose()
  })

  // 탭을 닫고 한참 뒤 다시 열었을 때 잊은 명령이 유령처럼 채워지면 안 된다
  it('탭을 닫으면 맡아 둔 것도 버린다', async () => {
    const bridge = await setup()
    bridge.fill('A', 'npm test')
    await bridge.closeProject('A')

    await handlers.get('pty:open')!({}, { name: 'shell' })
    const socket = sockets.get('ws://fake/pty_A')!
    socket.fireOpen()

    expect(socket.sent).toEqual([])
    await bridge.dispose()
  })
})
