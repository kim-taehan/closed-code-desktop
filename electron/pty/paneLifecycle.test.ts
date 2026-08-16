import { beforeEach, describe, expect, it, vi } from 'vitest'

// **붙는 도중에 떠났다 돌아와도 소켓은 하나인가.**
//
// 사용자 증상은 「셸에 `ls` 를 치면 `llls` 가 찍힌다」였다. 원인은 입력이 아니라 소켓 수다:
//
//   · 화면은 `open → detach → open` 을 잇달아 보낸다 (2026-08-16 계측: React StrictMode 가
//     효과를 붙였다 뗐다 다시 붙인다. 프로젝트를 빠르게 오갈 때도 같은 모양이다)
//   · `open` 은 서버에 두 번 왕복하는 async 라, 그 사이 지나가는 `detach` 는 **표에서 접을
//     소켓을 못 찾는다** — 아직 아무것도 안 들어 있다
//   · 뒤이은 `open` 이 같은 pty 에 소켓을 하나 더 붙이고, 앞엣것은 아무도 안 접는다
//
// 실물은 붙어 있는 소켓 **전부**에 출력을 뿌린다 (실측 1.18.18: 같은 pty 에 소켓 둘을 붙이고
// 한쪽으로 `l` 을 보내면 둘 다 받는다). 두 벌이 한 xterm 으로 모이면 zsh 의 줄 다시 그리기와
// 겹쳐 `ll\bls\bls` 가 되고, 그것이 화면에서 `llls` 다 — **입력은 한 번만 갔다.**
//
// 가짜는 `multiplex.test.ts`·`runPane.test.ts` 의 것과 같은 계약이다 (제목으로 되찾기 ·
// 열리기 전에는 못 쓴다). 파일을 나눈 것은 300줄 상한 때문이고, **가짜를 고칠 때는 셋 다
// 고쳐야 한다.** 여기만 다른 것 하나: 만들어진 소켓을 **전부** 세어 둔다 (겹침이 곧 결함이라).

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
const SHELL_URL = 'ws://fake/pty_closed-code-desktop 드로어'

interface FakeSocket {
  readonly url: string
  gone: boolean
  fireData(chunk: string): void
}

/** 만들어진 소켓 **전부**. ptyId 로 접으면 겹친 것이 하나로 보여 이 결함이 안 드러난다. */
const built: FakeSocket[] = []

vi.mock('./socket', () => ({
  PtySocket: class {
    /** 접혔는가. 접힌 소켓에는 아무것도 안 온다 — 살아 있는 것만 세려고 둔다 */
    gone = false
    readonly url: string
    private dataHandler: (chunk: string) => void = () => {}

    constructor(options: { url: string }) {
      this.url = options.url
      built.push(this as unknown as FakeSocket)
    }
    onOpen(): void {}
    onControl(): void {}
    onClose(): void {}
    onError(): void {}
    onData(handler: (chunk: string) => void): void {
      this.dataHandler = handler
    }
    open(): void {}
    fireData(chunk: string): void {
      this.dataHandler(chunk)
    }
    write(): boolean {
      return false
    }
    close(): void {
      this.gone = true
    }
  },
}))

/** 서버에 살아 있는 pty (제목 → 하나). 되찾기 경로가 여기서 나온다 */
const alive = new Map<string, { id: string; title: string; status: string }>()
/** 서버에 만들어진 pty 의 제목. **겹쳐 만들면 여기 둘이 쌓인다** */
const created: string[] = []

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return {
    ...actual,
    PtyClient: class {
      readonly headers = {}
      // 실물은 HTTP 왕복이다 — 즉시 돌려주면 `detach` 가 끼어들 틈이 없어 결함이 안 보인다
      async list(): Promise<unknown[]> {
        await new Promise(setImmediate)
        return [...alive.values()]
      }
      async create(_directory: string, input: { title: string }): Promise<{ id: string }> {
        await new Promise(setImmediate)
        created.push(input.title)
        const pty = { id: `pty_${input.title}`, title: input.title, status: 'running' }
        alive.set(input.title, pty)
        return pty
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
      remove(_directory: string, ptyId: string): Promise<void> {
        for (const [title, pty] of alive) if (pty.id === ptyId) alive.delete(title)
        return Promise.resolve()
      }
    },
  }
})

interface Sent {
  channel: string
  payload: { name?: string; chunk?: string }
}

describe('칸 하나의 수명 — 여닫기가 겹칠 때', () => {
  const pushed: Sent[] = []

  beforeEach(() => {
    handlers.clear()
    listeners.clear()
    built.length = 0
    alive.clear()
    created.length = 0
    pushed.length = 0
  })

  async function setup() {
    const { PtyDrawerBridge } = await import('./drawerBridge')
    const bridge = new PtyDrawerBridge({
      window: {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, scoped: { payload: Sent['payload'] }) =>
            pushed.push({ channel, payload: scoped.payload }),
        },
      } as never,
      activeProject: () => A,
      opencodeUrl: () => 'http://127.0.0.1:4096',
    })
    bridge.register()
    return bridge
  }

  const open = (name: string) => handlers.get('pty:open')!({}, { name })
  const detach = (name: string) => listeners.get('pty:detach')!({}, { projectId: 'A', name })
  /** 그 pty 에 **아직 붙어 있는** 소켓 */
  const live = () => built.filter((socket) => socket.url === SHELL_URL && !socket.gone)

  it('붙는 도중에 떠났다 돌아와도 소켓은 하나다', async () => {
    const bridge = await setup()

    // 왕복이 **끝나기 전에** 떠났다 돌아온다 — 기다리지 않는 것이 이 시험의 전부다
    const first = open('shell')
    detach('shell')
    const second = open('shell')
    await Promise.all([first, second])

    expect(live()).toHaveLength(1)
    // 붙어 있는 것 전부가 에코를 받는다 — 화면에 두 번 그려지는 자리가 여기다
    for (const socket of live()) socket.fireData('l')
    expect(pushed.filter((frame) => frame.channel === 'pty:data')).toEqual([
      { channel: 'pty:data', payload: { name: 'shell', chunk: 'l' } },
    ])
    await bridge.dispose()
  })

  // 소켓만 세면 못 보는 자리 — 겹친 `open` 이 서버에 pty 를 두 개 만들면, 화면에 안 보이는
  // 셸이 하나 남아 다음 실행의 되찾기가 그것을 집을 수도 있다
  it('겹쳐 열어도 서버에 pty 를 하나만 만든다', async () => {
    const bridge = await setup()

    await Promise.all([open('shell'), open('shell')])

    expect(created).toEqual(['closed-code-desktop 드로어'])
    await bridge.dispose()
  })

  // 떠난 뒤에 붙으면 아무도 그 소켓을 안 접는다 — 다음에 펼 때 같은 pty 에 둘이 된다
  it('붙는 도중에 떠나면 다 붙은 뒤에 접는다', async () => {
    const bridge = await setup()

    const opening = open('shell')
    detach('shell')
    await opening
    // 접기는 줄을 서므로 소켓이 붙은 다음 차례다 — 그 차례가 돌기를 기다린다
    await new Promise(setImmediate)

    expect(live()).toHaveLength(0)
    await bridge.dispose()
  })
})
