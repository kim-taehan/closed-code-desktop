import { beforeEach, describe, expect, it, vi } from 'vitest'

// **한 프로젝트에 칸이 여럿일 때 서로 섞이지 않는가** (설계 2026-08-16 §6 첫 줄).
//
// 예전에는 프로젝트당 pty 가 하나였다 — `open()` 이 `drawers.has(projectId)` 만 보고
// 돌아갔으므로 두 번째 이름으로 열어도 **첫 칸이 그대로 돌아왔다.** 그 상태에서 개발 서버를
// 띄우면 셸 칸이 잠긴다. 이 파일이 겨누는 것이 그 자리다.
//
// 섞이는 축이 셋이라 셋을 다 본다: **출력**(어느 화면에 찍히나) · **입력**(어느 셸이 받나) ·
// **종료**(하나가 끝나면 다른 하나도 끊기나).

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
  fireData(chunk: string): void
  fireClose(): void
}

/** ptyId 로 찾는다 — 칸 하나에 소켓 하나다 */
const sockets = new Map<string, FakeSocket>()
const closed: string[] = []

vi.mock('./socket', () => ({
  PtySocket: class {
    opened = false
    readonly sent: string[] = []
    private openHandler: () => void = () => {}
    private dataHandler: (chunk: string) => void = () => {}
    private closeHandler: () => void = () => {}

    constructor(private readonly options: { url: string }) {
      sockets.set(options.url, this)
    }
    onControl(): void {}
    onError(): void {}
    onOpen(handler: () => void): void {
      this.openHandler = handler
    }
    onData(handler: (chunk: string) => void): void {
      this.dataHandler = handler
    }
    onClose(handler: () => void): void {
      this.closeHandler = handler
    }
    open(): void {}
    fireOpen(): void {
      this.opened = true
      this.openHandler()
    }
    fireData(chunk: string): void {
      this.dataHandler(chunk)
    }
    fireClose(): void {
      this.closeHandler()
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

/** 서버에서 실제로 지워진 pty */
const removed: string[] = []
/** 서버에 살아 있는 pty (제목 → id). `list` 로 되찾는 경로가 여기서 나온다 */
const alive = new Map<string, { id: string; title: string; status: string }>()

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
        // 제목이 곧 이름이다 — 실물도 제목으로 되찾는다
        const pty = { id: `pty_${input.title}`, title: input.title, status: 'running' }
        alive.set(input.title, pty)
        return Promise.resolve(pty)
      }
      socketUrl(_directory: string, ptyId: string): string {
        return `ws://fake/${ptyId}`
      }
      get(_directory: string, ptyId: string): Promise<{ exitCode: number } | null> {
        return Promise.resolve(ptyId === 'pty_closed-code-desktop 드로어:dev' ? { exitCode: 7 } : null)
      }
      resize(): Promise<void> {
        return Promise.resolve()
      }
      remove(_directory: string, ptyId: string): Promise<void> {
        removed.push(ptyId)
        for (const [title, pty] of alive) if (pty.id === ptyId) alive.delete(title)
        return Promise.resolve()
      }
    },
  }
})

interface Sent {
  channel: string
  projectId: string
  payload: { name?: string; chunk?: string; exitCode?: number | null }
}

describe('pty 다중화 — 한 프로젝트의 칸 둘', () => {
  const pushed: Sent[] = []

  beforeEach(() => {
    handlers.clear()
    listeners.clear()
    sockets.clear()
    alive.clear()
    closed.length = 0
    removed.length = 0
    pushed.length = 0
  })

  async function setup() {
    const { PtyDrawerBridge } = await import('./drawerBridge')
    const bridge = new PtyDrawerBridge({
      window: {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, scoped: { projectId: string; payload: Sent['payload'] }) =>
            pushed.push({ channel, projectId: scoped.projectId, payload: scoped.payload }),
        },
      } as never,
      activeProject: () => A,
      opencodeUrl: () => 'http://127.0.0.1:4096',
    })
    bridge.register()
    return bridge
  }

  const open = (name: string) => handlers.get('pty:open')!({}, { name })
  const shell = () => sockets.get('ws://fake/pty_closed-code-desktop 드로어')!
  const dev = () => sockets.get('ws://fake/pty_closed-code-desktop 드로어:dev')!

  it('이름이 다르면 pty 도 따로 뜬다 — 셸 칸이 개발 서버에 잠기지 않는다', async () => {
    const bridge = await setup()
    await open('shell')
    await open('dev')

    expect(sockets.size).toBe(2)
    await bridge.dispose()
  })

  it('출력은 자기 이름을 달고 나간다', async () => {
    const bridge = await setup()
    await open('shell')
    await open('dev')

    shell().fireData('$ ')
    dev().fireData('vite ready\n')

    expect(pushed.filter((frame) => frame.channel === 'pty:data')).toEqual([
      { channel: 'pty:data', projectId: 'A', payload: { name: 'shell', chunk: '$ ' } },
      { channel: 'pty:data', projectId: 'A', payload: { name: 'dev', chunk: 'vite ready\n' } },
    ])
    await bridge.dispose()
  })

  // **층 사이가 이어졌는가.** 버퍼 자체는 `outputBuffer.test.ts` 가 잠그고 다중화는 위가
  // 잠그지만, "흘러간 바이트가 그 칸의 버퍼로 들어가는가" 는 둘 다 초록인 채로 빌 수 있다.
  it('지나간 출력이 칸마다 따로 쌓인다', async () => {
    const bridge = await setup()
    await open('shell')
    await open('dev')

    shell().fireData('ls\r\n')
    dev().fireData('vite ready\nport 5173\n')

    expect(bridge.logs('A', 'shell')?.lines).toEqual(['ls'])
    expect(bridge.logs('A', 'dev')?.lines).toEqual(['vite ready', 'port 5173'])
    // 안 연 칸은 null 이다 — 다음 층이 "그런 프로세스 없음" 으로 답할 수 있어야 한다
    expect(bridge.logs('A', 'test')).toBeNull()
    await bridge.dispose()
  })

  it('입력은 이름이 가리키는 칸에만 들어간다', async () => {
    const bridge = await setup()
    await open('shell')
    await open('dev')
    shell().fireOpen()
    dev().fireOpen()

    listeners.get('pty:input')!({}, { name: 'shell', data: 'ls\r' })

    expect(shell().sent).toEqual(['ls\r'])
    expect(dev().sent).toEqual([])
    await bridge.dispose()
  })

  // 하나가 끝나도 나머지는 그대로 돌아야 한다. 종료 프레임에 이름이 없으면 화면은
  // **아무 칸에서나** 「셸이 끝났습니다」를 그린다.
  it('한 칸이 끝나도 다른 칸은 살아 있다', async () => {
    const bridge = await setup()
    await open('shell')
    await open('dev')

    dev().fireClose()
    // 종료 코드는 프레임에 없어 다시 물어봐야 안다 (실측) — 그 왕복이 끝나기를 기다린다
    await new Promise(setImmediate)

    expect(pushed.filter((frame) => frame.channel === 'pty:exit')).toEqual([
      { channel: 'pty:exit', projectId: 'A', payload: { name: 'dev', exitCode: 7 } },
    ])
    // 셸 칸은 그대로 — 여기서 입력이 안 가면 한 칸의 죽음이 다른 칸을 끌고 간 것이다
    shell().fireOpen()
    listeners.get('pty:input')!({}, { name: 'shell', data: 'echo\r' })
    expect(shell().sent).toEqual(['echo\r'])
    await bridge.dispose()
  })

  // 탭을 닫으면 프로세스도 멈춘다 — 안 그러면 띄운 개발 서버가 화면에서만 사라진 채 계속 돈다
  it('탭을 닫으면 그 pty 만 서버에서 지워진다', async () => {
    const bridge = await setup()
    await open('shell')
    await open('dev')

    await handlers.get('pty:close')!({}, { projectId: 'A', name: 'dev' })

    expect(removed).toEqual(['pty_closed-code-desktop 드로어:dev'])
    expect(closed).toEqual(['ws://fake/pty_closed-code-desktop 드로어:dev'])
    await bridge.dispose()
  })

  // 접기·프로젝트 이동은 소켓만 접는다. 여기서 pty 를 지우면 다시 펼 때 스크롤백이 사라진다.
  it('떠나는 것은 그 칸의 소켓만 접고 pty 는 남긴다', async () => {
    const bridge = await setup()
    await open('shell')
    await open('dev')

    listeners.get('pty:detach')!({}, { projectId: 'A', name: 'dev' })

    expect(closed).toEqual(['ws://fake/pty_closed-code-desktop 드로어:dev'])
    expect(removed).toEqual([])
    await bridge.dispose()
  })

  // 앱을 끌 때. 셸 칸은 다음 실행이 같은 이름으로 되찾지만(`SHELL_PANE`), 그 밖의 칸은
  // 이름을 아무도 다시 부르지 않는다 — 안 거두면 서버에 아무도 못 찾는 셸이 쌓인다.
  it('앱을 끄면 되찾을 수 없는 칸만 거둔다', async () => {
    const bridge = await setup()
    await open('shell')
    await open('dev')

    await bridge.dispose()

    expect(removed).toEqual(['pty_closed-code-desktop 드로어:dev'])
  })

  // 서버에 우리 제목의 pty 가 이미 있으면 되찾는다 — 앱을 껐다 켜도 그 셸과 스크롤백이 그대로다
  it('되찾기는 이름별로 갈린다', async () => {
    const bridge = await setup()
    await open('shell')
    await bridge.dispose()

    sockets.clear()
    const again = await setup()
    await open('shell')

    // 새로 만들지 않았다 — 같은 ptyId 에 다시 붙었다
    expect([...sockets.keys()]).toEqual(['ws://fake/pty_closed-code-desktop 드로어'])
    await again.dispose()
  })
})
