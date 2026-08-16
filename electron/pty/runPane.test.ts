import { beforeEach, describe, expect, it, vi } from 'vitest'

// **이미 돌고 있으면 겹쳐 띄우지 않는가** (설계 §6 넷째 줄).
//
// 위층(`electron/mcp/runAndLogs.test.ts`)은 가짜 포트로 문장만 본다. 여기서 보는 것은
// **정말로 안 띄우는가** 다 — 두 층이 각각 잠겨 있어도 그 사이가 비면 모델에게는 "안
// 띄웠다" 고 말하면서 서버에는 개발 서버가 둘 도는 일이 생긴다.
//
// 가짜는 `multiplex.test.ts` 의 것과 같은 계약이다 (제목으로 되찾기 · 열리기 전에는 못 쓴다).
// 파일을 나눈 것은 300줄 상한 때문이고, **가짜를 고칠 때는 둘 다 고쳐야 한다.**

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

interface FakeSocket {
  readonly sent: string[]
  fireOpen(): void
}

const sockets = new Map<string, FakeSocket>()

// **열리기 전에는 못 쓴다** — 실물이 그렇다 (`socket.ts` 의 실측). 여기서 그냥 받아 주면
// "맡아 뒀다 열릴 때 넣는다" 는 규칙이 없어도 초록이 나온다.
vi.mock('./socket', () => ({
  PtySocket: class {
    opened = false
    readonly sent: string[] = []
    private openHandler: () => void = () => {}

    constructor(options: { url: string }) {
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
    close(): void {}
  },
}))

/** 서버에 살아 있는 pty (제목 → 하나). 되찾기 경로가 여기서 나온다 */
const alive = new Map<string, { id: string; title: string; status: string }>()
/** 서버에 만들어진 pty 의 제목. **겹쳐 띄우면 여기 둘이 쌓인다** */
const created: string[] = []

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return {
    ...actual,
    PtyClient: class {
      readonly headers = {}
      list(): Promise<unknown[]> {
        return Promise.resolve([...alive.values()])
      }
      create(_directory: string, input: { title: string }): Promise<{ id: string }> {
        created.push(input.title)
        const pty = { id: `pty_${input.title}`, title: input.title, status: 'running' }
        alive.set(input.title, pty)
        return Promise.resolve(pty)
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

describe('PtyDrawerBridge — run_project', () => {
  let active: { id: string; root: string } | null = A

  beforeEach(() => {
    handlers.clear()
    listeners.clear()
    sockets.clear()
    alive.clear()
    created.length = 0
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

  const dev = () => sockets.get('ws://fake/pty_closed-code-desktop 드로어:dev')!

  it('칸을 띄우고, 소켓이 열릴 때 명령을 개행까지 넣는다', async () => {
    const bridge = await setup()
    const result = await bridge.run('A', 'dev', 'npm run dev')

    expect(result).toEqual({ ok: true, started: true })
    // 붙는 중(CONNECTING)이라 아직 못 쓴다 — 여기서 쓰면 흔적 없이 사라진다
    expect(dev().sent).toEqual([])

    dev().fireOpen()
    expect(dev().sent).toEqual(['npm run dev\n'])
    await bridge.dispose()
  })

  // 이 파일의 이유. 겹쳐 띄우면 개발 서버가 둘이 되고, 뒤엣것은 포트를 못 잡고 죽거나
  // 다른 포트를 잡아 사용자가 보던 주소가 조용히 어긋난다.
  it('같은 이름이 이미 붙어 있으면 아무것도 안 한다', async () => {
    const bridge = await setup()
    await bridge.run('A', 'dev', 'npm run dev')
    dev().fireOpen()

    const again = await bridge.run('A', 'dev', 'npm run dev')

    expect(again).toEqual({ ok: true, started: false })
    // pty 도 하나뿐이고, 명령도 한 번만 들어갔다
    expect(created).toEqual(['closed-code-desktop 드로어:dev'])
    expect(dev().sent).toEqual(['npm run dev\n'])
    await bridge.dispose()
  })

  // 앱이 죽었다 켜지면 표는 비어 있지만 서버의 pty 는 살아 있다. 표만 보면 "안 돌고 있다" 로
  // 읽어 명령을 또 밀어 넣는다 — 되찾은 칸에서 그러면 **한 칸에서 둘이 돈다.**
  it('서버에 살아 있는 것을 되찾았으면 명령을 다시 넣지 않는다', async () => {
    alive.set('closed-code-desktop 드로어:dev', {
      id: 'pty_closed-code-desktop 드로어:dev',
      title: 'closed-code-desktop 드로어:dev',
      status: 'running',
    })
    const bridge = await setup()

    const result = await bridge.run('A', 'dev', 'npm run dev')
    dev().fireOpen()

    expect(result).toEqual({ ok: true, started: false })
    expect(created).toEqual([])
    expect(dev().sent).toEqual([])
    await bridge.dispose()
  })

  it('이름이 다르면 따로 뜬다 — 셸 칸이 잠기지 않는다', async () => {
    const bridge = await setup()
    await handlers.get('pty:open')!({}, { name: 'shell' })
    await bridge.run('A', 'dev', 'npm run dev')

    expect(sockets.size).toBe(2)
    await bridge.dispose()
  })

  // 뒤에 있는 프로젝트에서 띄우면 화면에 탭이 안 생기고, 탭이 없으면 멈출 문이 없다
  it('앞에 나와 있지 않은 프로젝트에는 띄우지 않는다', async () => {
    const bridge = await setup()
    const result = await bridge.run('B', 'dev', 'npm run dev')

    expect(result.ok).toBe(false)
    expect(created).toEqual([])
    await bridge.dispose()
  })

  it('서버가 아직 없으면 사유를 그대로 돌려준다', async () => {
    const { PtyDrawerBridge } = await import('./drawerBridge')
    const bridge = new PtyDrawerBridge({
      window: { isDestroyed: () => false, webContents: { send: () => {} } } as never,
      activeProject: () => A,
      opencodeUrl: () => null,
    })

    const result = await bridge.run('A', 'dev', 'npm run dev')

    expect(result).toEqual({ ok: false, error: '이 프로젝트의 opencode 서버가 아직 뜨지 않았습니다' })
    await bridge.dispose()
  })

  // 띄운 칸에 버퍼가 없으면 `read_logs` 는 "그런 것 없다" 만 돌려준다 — 흘러간 바이트가
  // 정말 그 버퍼로 들어가는지는 `multiplex.test.ts` 가 본다
  it('띄운 칸은 read_logs 가 찾을 수 있다', async () => {
    const bridge = await setup()
    await bridge.run('A', 'dev', 'npm run dev')

    expect(bridge.logs('A', 'dev')).not.toBeNull()
    expect(bridge.logs('A', '안띄운것')).toBeNull()
    await bridge.dispose()
  })
})
