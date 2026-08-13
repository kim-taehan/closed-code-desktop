import { HandlerSet, type Unsubscribe } from '../ws/transport'
import {
  createNotice,
  createRequest,
  NOTICE_SHUTDOWN,
  parseFromChild,
  PendingRequests,
  type RpcMessage,
  type RpcResponse,
} from './rpc'

// 확장 호스트 utilityProcess **하나의 수명만** 책임진다.
// 확장 여러 개의 로드·활성화는 자식(hostEntry.ts)이 하고,
// 크래시 횟수·백오프 같은 재기동 **정책**은 여기 넣지 않는다 —
// RuntimeManager 가 286줄까지 부푼 것이 수명+정책을 한 파일에 담아서다.
// 정책이 필요해지면 hostSupervisor.ts 로 분리한다 (탐색 §7.2).

/** shutdown 통지 후 자식이 스스로 나가기를 기다리는 시간. 넘으면 kill(). */
export const SHUTDOWN_WAIT_MS = 3_000

/** app.getAppMetrics() 에 이 이름으로 뜬다 — 좀비 추적의 유일한 창구다 (spike §영향 7). */
export const SERVICE_NAME = 'code-extension-host'

/**
 * 'error'(V8 FatalError)에는 종료 코드가 없다. 정상 종료(0)와 구분되기만 하면 되므로
 * 음수로 정규화한다. 크래시 판정은 code !== 0 이다 (spike: 정상 kill=0, throw=1).
 */
export const FATAL_ERROR_EXIT_CODE = -1

/** stdout/stderr 에서 쓰는 것은 'data' 구독뿐이다. */
export interface HostStream {
  on(event: 'data', listener: (chunk: unknown) => void): unknown
}

/**
 * host.ts 가 실제로 쓰는 utilityProcess 표면만 추린 구조 타입.
 *
 * Electron.UtilityProcess 를 직접 참조하지 않는 이유: vitest 는 node 환경이라
 * electron 모듈이 가짜다 — `utilityProcess` 가 undefined 로 나오고 던지지도 않는다(탐색 §5.1).
 */
export interface HostChild {
  readonly stdout: HostStream | null
  readonly stderr: HostStream | null
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  on(event: 'error', listener: () => void): unknown
  postMessage(message: unknown): void
  kill(): boolean
}

export type ForkFn = (
  modulePath: string,
  args?: string[],
  options?: { stdio?: 'pipe'; serviceName?: string },
) => HostChild

export interface ExtensionHostOptions {
  /** hostEntry.js 의 절대 경로. dev·asar 양쪽에서 같다 (탐색 §1.1). */
  entryPath: string
  /**
   * utilityProcess.fork 주입점.
   *
   * 설계 §10 DIP 가 실제로 값을 하는 지점이다 — 기동·크래시·유예종료 테스트가
   * electron 모킹 없이 가짜 fork 로 전부 돈다. 실제 결선은 main.ts 한 줄뿐이다.
   */
  fork: ForkFn
}

export class ExtensionHost {
  private child: HostChild | null = null
  private exited = false
  /**
   * 몇 번째 자식인가. `respawn` 때문에 필요하다 — `kill()` 은 신호만 보내고 `exit` 은
   * 나중에 오므로, 새 자식이 뜬 뒤에 **옛 자식의 종료가 도착**할 수 있다. 세대를 안 보면
   * 그 지각 신호가 멀쩡히 도는 새 자식의 자리를 비운다.
   */
  private generation = 0
  private readonly exitHandlers = new HandlerSet<[number]>()
  private readonly logHandlers = new HandlerSet<[string]>()
  private readonly messageHandlers = new HandlerSet<[RpcMessage]>()
  private readonly pending = new PendingRequests()

  constructor(private readonly options: ExtensionHostOptions) {}

  /** 이미 끝났는가. 기동 대기 중 조기 포기 판단에 쓴다. */
  get hasExited(): boolean {
    return this.exited
  }

  onExit(handler: (code: number) => void): Unsubscribe {
    return this.exitHandlers.add(handler)
  }

  onLog(handler: (line: string) => void): Unsubscribe {
    return this.logHandlers.add(handler)
  }

  /** 응답을 뺀 수신 메시지. 응답은 request() 의 Promise 로 풀리고 여기로 오지 않는다. */
  onMessage(handler: (message: RpcMessage) => void): Unsubscribe {
    return this.messageHandlers.add(handler)
  }

  start(): void {
    if (this.child) throw new Error('확장 호스트가 이미 실행 중입니다')

    const generation = (this.generation += 1)
    this.exited = false
    const child = this.options.fork(this.options.entryPath, [], {
      // 기본값은 'inherit' 라 자식 로그가 앱 로그창에 안 남는다.
      stdio: 'pipe',
      serviceName: SERVICE_NAME,
    })
    this.child = child

    child.stdout?.on('data', (chunk) => this.logHandlers.emit(String(chunk)))
    // 확장이 던진 스택 전문이 그대로 여기로 온다 (spike 실측) — 별도 오류 채널이 필요 없다.
    child.stderr?.on('data', (chunk) => this.logHandlers.emit(String(chunk)))

    child.on('message', (message) => this.receive(message))
    child.on('exit', (code) => this.handleExit(code, generation))
    // 'error' 는 V8 FatalError 전용이고 뒤이어 'exit' 이 온다(electron.d.ts:14035-14041).
    // 그래도 기동 실패를 한 갈래로 모은다 (RuntimeProcess:76-81 과 같은 결).
    child.on('error', () => this.handleExit(FATAL_ERROR_EXIT_CODE, generation))
  }

  /**
   * 자식을 **새로 띄운다.** `stop()` 뒤에 부른다.
   *
   * `stop()` 이 돌아와도 자식 자리가 비어 있다는 보장이 없다 — 유예 시간을 넘겨 `kill()`
   * 로 갔다면 `exit` 은 아직 오지 않았고, 그 상태로 `start()` 하면 "이미 실행 중" 으로 던진다.
   * 그래서 여기서 자리를 **먼저 비운다.**
   *
   * 종료를 알리지 않는다(`exitHandlers`) — 이건 죽은 것이 아니라 갈아 끼우는 것이라,
   * 종료로 치면 기다리던 쪽이 "호스트가 죽었다" 로 풀려난다.
   */
  respawn(): void {
    this.child?.kill()
    this.child = null
    this.pending.rejectAll('확장 호스트를 다시 띄웁니다')
    this.start()
  }

  /** 호스트에 요청을 보내고 응답을 기다린다. 호스트가 죽으면 거부된다. */
  request(method: string, params?: unknown): Promise<unknown> {
    const child = this.child
    if (!child) return Promise.reject(new Error('확장 호스트가 실행 중이 아닙니다'))

    const message = createRequest(method, params)
    const waiting = this.pending.track(message.id)
    child.postMessage(message)
    return waiting
  }

  /**
   * 자식이 보낸 요청에 답한다. 호스트가 없으면 false 를 돌려주고 던지지 않는다.
   *
   * 요청은 onMessage 로 올라가고 답은 이 메서드로 내려간다 — 자식이 확장 API 를
   * 부르기 시작하면서 필요해진 방향이다. 짝짓기는 부르는 쪽이 `id` 로 한다.
   */
  respond(response: RpcResponse): boolean {
    if (!this.child) return false
    this.child.postMessage(response)
    return true
  }

  /** 응답이 없는 통지를 보낸다. 호스트가 없으면 false 를 돌려주고 던지지 않는다. */
  notify(method: string, params?: unknown): boolean {
    if (!this.child) return false
    this.child.postMessage(createNotice(method, params))
    return true
  }

  /**
   * 유예 종료: shutdown 통지 → 대기 → 타임아웃이면 kill().
   *
   * 바로 kill() 하면 확장이 쓰던 산출물을 마무리할 틈이 없다.
   * RuntimeProcess.stop():84-98 과 같은 의도지만, utilityProcess 에는 시그널 인자가 없어
   * SIGTERM 자리를 통지 메시지가 대신한다.
   */
  async stop(waitMs = SHUTDOWN_WAIT_MS): Promise<void> {
    const child = this.child
    if (!child) return

    child.postMessage(createNotice(NOTICE_SHUTDOWN))

    const exitedInTime = await this.waitForExit(waitMs)
    if (!exitedInTime && this.child) this.child.kill()
  }

  /** 종료를 기다린다. 시간 안에 끝나면 true. (runtimeProcess.ts:101-115 이식) */
  waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.hasExited) return Promise.resolve(true)

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe()
        resolve(false)
      }, timeoutMs)

      const unsubscribe = this.onExit(() => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  dispose(): void {
    this.child?.kill()
    this.child = null
    this.pending.rejectAll('확장 호스트가 정리되었습니다')
    this.exitHandlers.clear()
    this.logHandlers.clear()
    this.messageHandlers.clear()
  }

  private receive(raw: unknown): void {
    const message = parseFromChild(raw)
    if (!message) {
      this.logHandlers.emit(`[확장 호스트] 알 수 없는 메시지: ${JSON.stringify(raw)}`)
      return
    }

    if (message.kind === 'response') {
      // 짝이 없는 응답 = 이미 거부된(종료·정리) 요청의 뒤늦은 답. 버리되 조용히 버리지 않는다.
      if (!this.pending.settle(message)) this.logHandlers.emit(`[확장 호스트] 짝 없는 응답 id=${message.id}`)
      return
    }

    this.messageHandlers.emit(message)
  }

  /** 'error' 와 'exit' 이 잇달아 와도 한 번만 정리한다. */
  private handleExit(code: number, generation: number): void {
    // 지각한 옛 자식의 종료. 새 자식이 이미 도는 중이라 건드리면 안 된다
    if (generation !== this.generation) return
    if (this.exited) return
    this.exited = true
    this.child = null
    this.pending.rejectAll(`확장 호스트가 종료되었습니다 (code=${code})`)
    this.exitHandlers.emit(code)
  }
}
