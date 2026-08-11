import { describe, expect, it, vi } from 'vitest'
import { ExtensionHost, SERVICE_NAME, type ForkFn, type HostChild, type HostStream } from './host'
import {
  createNotice,
  errorResponse,
  METHOD_PING,
  NOTICE_READY,
  NOTICE_SHUTDOWN,
  okResponse,
  parseRpcMessage,
  type RpcMessage,
} from './rpc'

// 진짜 utilityProcess 는 vitest(node 환경)에서 애초에 돌지 않는다 — electron 모듈이
// 실행파일 경로 문자열이라 utilityProcess 가 undefined 로 나오고 던지지도 않는다(탐색 §5.1).
// 그래서 host.ts 는 fork 를 주입받고, 여기서는 가짜 자식으로 계약을 전부 잠근다.

class FakeStream implements HostStream {
  private readonly listeners = new Set<(chunk: unknown) => void>()

  on(_event: 'data', listener: (chunk: unknown) => void): void {
    this.listeners.add(listener)
  }

  push(chunk: unknown): void {
    for (const listener of this.listeners) listener(chunk)
  }
}

class FakeChild implements HostChild {
  readonly stdout = new FakeStream()
  readonly stderr = new FakeStream()
  readonly sent: RpcMessage[] = []
  killed = false

  private onMessage: ((message: unknown) => void) | null = null
  private onExit: ((code: number) => void) | null = null
  private onError: (() => void) | null = null

  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  on(event: 'error', listener: () => void): void
  on(event: 'message' | 'exit' | 'error', listener: (...args: never[]) => void): void {
    if (event === 'message') this.onMessage = listener as (message: unknown) => void
    else if (event === 'exit') this.onExit = listener as (code: number) => void
    else this.onError = listener as () => void
  }

  postMessage(message: unknown): void {
    const parsed = parseRpcMessage(message)
    if (parsed) this.sent.push(parsed)
  }

  kill(): boolean {
    this.killed = true
    return true
  }

  /** 자식이 부모에게 보내는 흉내. 부모 쪽은 껍질 없이 평평하게 받는다 (spike 비대칭). */
  emitMessage(message: unknown): void {
    this.onMessage?.(message)
  }

  emitExit(code: number): void {
    this.onExit?.(code)
  }

  emitError(): void {
    this.onError?.()
  }

  /** 마지막으로 받은 요청의 id. 응답을 짝지어 돌려줄 때 쓴다. */
  lastRequestId(): string {
    const request = [...this.sent].reverse().find((message) => message.kind === 'request')
    if (!request) throw new Error('보낸 요청이 없습니다')
    return request.id
  }
}

function makeHost(): { host: ExtensionHost; child: FakeChild; forkCalls: Parameters<ForkFn>[] } {
  const child = new FakeChild()
  const forkCalls: Parameters<ForkFn>[] = []
  const host = new ExtensionHost({
    entryPath: '/앱/dist-electron/electron/extensions/hostEntry.js',
    fork: (modulePath, args, options) => {
      forkCalls.push([modulePath, args, options])
      return child
    },
  })
  return { host, child, forkCalls }
}

describe('확장 호스트 기동', () => {
  it('엔트리 경로와 함께 stdio:pipe · serviceName 을 채워 fork 한다', () => {
    const { host, forkCalls } = makeHost()
    host.start()

    expect(forkCalls).toHaveLength(1)
    expect(forkCalls[0]?.[0]).toBe('/앱/dist-electron/electron/extensions/hostEntry.js')
    // serviceName 은 getAppMetrics() 의 좀비 추적 창구다 — 비면 이름 없는 프로세스가 된다.
    expect(forkCalls[0]?.[2]).toEqual({ stdio: 'pipe', serviceName: SERVICE_NAME })
  })

  it('두 번 start 하면 던진다 (자식이 두 번 뜨는 것을 막는다)', () => {
    const { host } = makeHost()
    host.start()
    expect(() => host.start()).toThrow()
  })

  it('자식의 ready 통지를 onMessage 로 올린다', () => {
    const { host, child } = makeHost()
    const seen: RpcMessage[] = []
    host.onMessage((message) => seen.push(message))
    host.start()

    child.emitMessage(createNotice(NOTICE_READY, { pid: 4242 }))

    expect(seen).toEqual([{ kind: 'notice', method: NOTICE_READY, params: { pid: 4242 } }])
  })

  it('stdout·stderr 를 onLog 로 올린다', () => {
    const { host, child } = makeHost()
    const lines: string[] = []
    host.onLog((line) => lines.push(line))
    host.start()

    child.stdout.push(Buffer.from('[ext-host] booted'))
    // 확장이 던진 스택 전문이 stderr 로 그대로 온다 (spike 실측)
    child.stderr.push(Buffer.from('Error: 확장이 죽는 상황\n    at foo'))

    expect(lines).toEqual(['[ext-host] booted', 'Error: 확장이 죽는 상황\n    at foo'])
  })
})

describe('확장 호스트 메시지 왕복', () => {
  it('요청을 보내고 같은 id 의 응답으로 푼다', async () => {
    const { host, child } = makeHost()
    host.start()

    const answer = host.request(METHOD_PING)
    const id = child.lastRequestId()
    child.emitMessage(okResponse(id, { pid: 77 }))

    await expect(answer).resolves.toEqual({ pid: 77 })
  })

  it('요청마다 id 가 다르다 (응답이 엉뚱한 요청을 풀면 안 된다)', () => {
    const { host, child } = makeHost()
    host.start()

    void host.request(METHOD_PING).catch(() => undefined)
    const first = child.lastRequestId()
    void host.request(METHOD_PING).catch(() => undefined)
    const second = child.lastRequestId()

    expect(first).not.toBe(second)
  })

  it('실패 응답은 거부로 푼다', async () => {
    const { host, child } = makeHost()
    host.start()

    const answer = host.request('없는.메서드')
    child.emitMessage(errorResponse(child.lastRequestId(), '알 수 없는 메서드: 없는.메서드'))

    await expect(answer).rejects.toThrow('알 수 없는 메서드')
  })

  it('짝 없는 응답은 조용히 버리지 않고 로그로 남긴다', () => {
    const { host, child } = makeHost()
    const lines: string[] = []
    host.onLog((line) => lines.push(line))
    host.start()

    child.emitMessage(okResponse('없는-id', null))

    expect(lines.join('\n')).toContain('짝 없는 응답')
  })

  it('기동 전 요청은 던지지 않고 거부한다', async () => {
    const { host } = makeHost()
    await expect(host.request(METHOD_PING)).rejects.toThrow('실행 중이 아닙니다')
  })
})

describe('확장 호스트 크래시', () => {
  it('자식이 죽으면 onExit 이 code≠0 으로 온다 (정상 kill=0 과 갈린다)', () => {
    const { host, child } = makeHost()
    const codes: number[] = []
    host.onExit((code) => codes.push(code))
    host.start()

    child.emitExit(1)

    expect(codes).toEqual([1])
    expect(host.hasExited).toBe(true)
  })

  it("'error' 도 exit 으로 정규화하고 뒤따르는 exit 을 중복 발화하지 않는다", () => {
    const { host, child } = makeHost()
    const codes: number[] = []
    host.onExit((code) => codes.push(code))
    host.start()

    child.emitError()
    child.emitExit(1)

    expect(codes).toHaveLength(1)
    expect(codes[0]).not.toBe(0)
  })

  it('죽으면 기다리던 요청을 거부한다 (await 가 영원히 걸리지 않는다)', async () => {
    const { host, child } = makeHost()
    host.start()

    const answer = host.request(METHOD_PING)
    child.emitExit(1)

    await expect(answer).rejects.toThrow('종료되었습니다')
  })
})

describe('확장 호스트 유예 종료', () => {
  it('shutdown 통지를 먼저 보내고, 자식이 나가면 kill 하지 않는다', async () => {
    const { host, child } = makeHost()
    host.start()

    const stopping = host.stop(50)
    expect(child.sent.at(-1)).toEqual(createNotice(NOTICE_SHUTDOWN))

    child.emitExit(0)
    await stopping

    expect(child.killed).toBe(false)
  })

  it('유예 시간을 넘기면 kill() 로 넘어간다', async () => {
    vi.useFakeTimers()
    try {
      const { host, child } = makeHost()
      host.start()

      const stopping = host.stop(3_000)
      await vi.advanceTimersByTimeAsync(3_000)
      await stopping

      expect(child.killed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('기동하지 않았으면 stop 은 아무것도 하지 않는다', async () => {
    const { host, child } = makeHost()
    await host.stop(10)
    expect(child.killed).toBe(false)
    expect(child.sent).toHaveLength(0)
  })
})

describe('확장 호스트 정리', () => {
  it('dispose 후에는 핸들러가 불리지 않는다', () => {
    const { host, child } = makeHost()
    const exits: number[] = []
    const lines: string[] = []
    const messages: RpcMessage[] = []
    host.onExit((code) => exits.push(code))
    host.onLog((line) => lines.push(line))
    host.onMessage((message) => messages.push(message))
    host.start()

    host.dispose()

    child.emitExit(1)
    child.stdout.push(Buffer.from('늦게 온 로그'))
    child.emitMessage(createNotice(NOTICE_READY))

    expect(exits).toEqual([])
    expect(lines).toEqual([])
    expect(messages).toEqual([])
  })

  it('dispose 는 자식을 kill 하고 기다리던 요청을 거부한다', async () => {
    const { host, child } = makeHost()
    host.start()

    const answer = host.request(METHOD_PING)
    host.dispose()

    expect(child.killed).toBe(true)
    await expect(answer).rejects.toThrow('정리되었습니다')
  })
})
