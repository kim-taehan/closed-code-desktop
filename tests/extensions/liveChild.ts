import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createChildHandler } from '../../electron/extensions/childHandlers'
import { createExtensionApi } from '../../electron/extensions/extensionApi'
import {
  createNotice,
  createRequest,
  NOTICE_SHUTDOWN,
  errorResponse,
  NOTICE_READY,
  okResponse,
  parseRpcMessage,
  PendingRequests,
} from '../../electron/extensions/rpc'
import type { HostChild, HostStream } from '../../electron/extensions/host'

// **진짜로 도는** 자식 프로세스 흉내. 확장 하나를 끝까지 굴려 보는 테스트들이 함께 쓴다.
//
// `serviceKit.ts` 의 `FakeChild` 와 다르다: 저쪽은 부모가 무엇을 보냈는지만 모으고
// 확장을 싣지 않는다. 이쪽은 `hostEntry.ts` 와 **같은 배선**을 써서 진짜로 싣고 실행한다 —
// require · activate · code.* 왕복이 전부 실제 코드다.
// (진짜 utilityProcess 는 vitest 에서 애초에 뜨지 않는다 — `host.test.ts` 머리말 참조.)
//
// 원래 확장 왕복 테스트들이 한 벌씩 옮겨 적고 있었고, 거기 "셋째가 생기면 그때 뽑는다"
// 고 적혀 있었다. 지금은 호스트 시험과 확장 자신의 시험이 함께 쓴다.

/** 확장의 `require()` 가 이 파일 기준으로 풀린다. main 은 절대경로로 오므로 기준점은 형식상이다. */
const nodeRequire = createRequire(join(__dirname, 'liveChild.ts'))

export class NullStream implements HostStream {
  on(_event: 'data', _listener: (chunk: unknown) => void): void {}
}

export class LiveChild implements HostChild {
  readonly stdout = new NullStream()
  readonly stderr = new NullStream()
  /** 확장이 남긴 로그. 보는 테스트만 읽는다. */
  readonly logs: string[] = []

  private toParent: ((message: unknown) => void) | null = null
  private toExit: ((code: number) => void) | null = null
  private readonly pending = new PendingRequests()
  private readonly handle: (request: ReturnType<typeof createRequest>) => Promise<unknown>

  constructor() {
    const call = (method: string, params?: unknown): Promise<unknown> => {
      const message = createRequest(method, params)
      const waiting = this.pending.track(message.id)
      this.toParent?.(message)
      return waiting
    }
    // 실제 자식과 같게 **확장마다** 만든다 — storage 가 확장별로 갈리는 근거다
    this.handle = createChildHandler((name) => createExtensionApi(call, name), {
      requireModule: (absolutePath) => nodeRequire(absolutePath),
      log: (line) => this.logs.push(line),
    })
    // 부모가 리스너를 붙인 뒤에 "떴다" 를 알린다 (실제 자식도 fork 직후가 아니다)
    queueMicrotask(() => this.toParent?.(createNotice(NOTICE_READY, { pid: 0 })))
  }

  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  on(event: 'error', listener: () => void): void
  on(event: 'message' | 'exit' | 'error', listener: (...args: never[]) => void): void {
    if (event === 'message') this.toParent = listener as (message: unknown) => void
    if (event === 'exit') this.toExit = listener as (code: number) => void
  }

  /** 부모 → 자식. 실제 자식은 event.data 껍질을 벗기지만 여기서는 보낸 것을 그대로 받는다. */
  postMessage(message: unknown): void {
    const parsed = parseRpcMessage(message)
    if (!parsed) return
    // 실제 자식은 이 통지를 받으면 `process.exit(0)` 한다 (`hostEntry.ts`).
    // 흉내내지 않으면 부모의 유예 종료가 매번 타임아웃까지 기다린다.
    if (parsed.kind === 'notice' && parsed.method === NOTICE_SHUTDOWN) {
      this.exit(0)
      return
    }
    if (parsed.kind === 'response') {
      this.pending.settle(parsed)
      return
    }
    if (parsed.kind !== 'request') return

    void this.handle(parsed)
      .then((result) => this.toParent?.(okResponse(parsed.id, result)))
      .catch((error: unknown) => this.toParent?.(errorResponse(parsed.id, String(error))))
  }

  kill(): boolean {
    this.exit(0)
    return true
  }

  /** 종료는 **비동기로** 알린다 — 실제 프로세스의 'exit' 이 그렇고, 부모가 그 사이를 다룬다. */
  private exit(code: number): void {
    const notify = this.toExit
    this.toExit = null
    this.toParent = null
    if (notify) queueMicrotask(() => notify(code))
  }
}
