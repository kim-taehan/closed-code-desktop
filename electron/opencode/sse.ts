import { HandlerSet, type Unsubscribe } from '../ws/transport'
import { parseEvent, type OpencodeEvent } from './events'

// opencode `GET /event` SSE 리더.
//
// 와이어 형식은 표준 SSE 다 — 실측: `data: {json}\n\n` (od 로 확인, 1.17.18).
// 이벤트 이름(`event:` 줄)은 쓰지 않고 전부 기본 message 이벤트로 온다.
//
// WsConnection 과 같은 자리에 서므로 재연결 정책도 같게 맞춘다 (상한 둔 지수 백오프,
// 무기한 재시도). 서버가 재시작해도 화면이 영구 오류로 굳지 않게 하는 것이 목적이다.

export interface SseOptions {
  url: string
  headers?: Record<string, string>
  fetchImpl?: typeof fetch
  initialReconnectDelayMs?: number
  maxReconnectDelayMs?: number
  autoReconnect?: boolean
}

const DEFAULTS = { initialReconnectDelayMs: 500, maxReconnectDelayMs: 30_000, autoReconnect: true }

export class SseStream {
  private controller: AbortController | null = null
  private closed = false
  private attempts = 0
  private timer: NodeJS.Timeout | null = null
  private connected = false

  private readonly eventHandlers = new HandlerSet<[OpencodeEvent]>()
  private readonly openHandlers = new HandlerSet<[]>()
  private readonly closeHandlers = new HandlerSet<[]>()
  private readonly errorHandlers = new HandlerSet<[Error]>()

  private readonly options: Required<Omit<SseOptions, 'headers' | 'fetchImpl'>> &
    Pick<SseOptions, 'headers' | 'fetchImpl'>

  constructor(options: SseOptions) {
    this.options = { ...DEFAULTS, ...options }
  }

  get isOpen(): boolean {
    return this.connected
  }

  onEvent(handler: (event: OpencodeEvent) => void): Unsubscribe {
    return this.eventHandlers.add(handler)
  }
  onOpen(handler: () => void): Unsubscribe {
    return this.openHandlers.add(handler)
  }
  onClose(handler: () => void): Unsubscribe {
    return this.closeHandlers.add(handler)
  }
  onError(handler: (error: Error) => void): Unsubscribe {
    return this.errorHandlers.add(handler)
  }

  start(): void {
    if (this.closed) return
    void this.connect()
  }

  close(): void {
    this.closed = true
    this.clearTimer()
    this.controller?.abort()
    this.controller = null
    if (this.connected) {
      this.connected = false
      this.closeHandlers.emit()
    }
  }

  /**
   * 살아 있다고 믿던 스트림을 버리고 **곧바로 다시** 붙는다.
   *
   * `close()` 와 다르다 — close 는 영구 종료라 이후 start() 가 아무것도 하지 않는다.
   * 절전 복귀처럼 "우리 쪽은 열려 있는데 상대는 이미 끊은" 상황에 쓴다 (sessionWake.ts).
   */
  recycle(): void {
    if (this.closed) return
    this.clearTimer()
    this.controller?.abort()
    this.controller = null
    if (this.connected) {
      this.connected = false
      this.closeHandlers.emit()
    }
    this.attempts = 0
    this.timer = setTimeout(() => void this.connect(), 0)
  }

  private async connect(): Promise<void> {
    if (this.closed) return
    const fetchImpl = this.options.fetchImpl ?? fetch
    const controller = new AbortController()
    this.controller = controller

    try {
      const response = await fetchImpl(this.options.url, {
        headers: { Accept: 'text/event-stream', ...(this.options.headers ?? {}) },
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        throw new Error(`SSE 연결 실패: HTTP ${response.status}`)
      }

      this.attempts = 0
      this.connected = true
      this.openHandlers.emit()
      await this.pump(response.body)
      // 스트림이 정상 종료됐다 — 서버가 끊은 것이므로 재연결 대상이다.
      this.onDisconnected()
    } catch (error) {
      if (controller.signal.aborted || this.closed) return
      this.errorHandlers.emit(error instanceof Error ? error : new Error(String(error)))
      this.onDisconnected()
    }
  }

  /**
   * 바이트 → 이벤트. 청크 경계가 프레임 경계와 다르므로 버퍼에 모아 `\n\n` 로 자른다.
   *
   * 이 버퍼링을 빼면 큰 이벤트(도구 결과 등)가 중간에서 잘려 JSON.parse 가 조용히 실패한다.
   */
  private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        this.emitFrame(frame)
        boundary = buffer.indexOf('\n\n')
      }
    }
  }

  /** SSE 프레임 하나(여러 줄일 수 있다)에서 data 줄만 이어 붙여 파싱한다. */
  private emitFrame(frame: string): void {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('')
    if (!data) return
    const event = parseEvent(data)
    if (event) this.eventHandlers.emit(event)
  }

  private onDisconnected(): void {
    if (this.closed) return
    if (this.connected) {
      this.connected = false
      this.closeHandlers.emit()
    }
    if (!this.options.autoReconnect) return

    const delay = Math.min(
      this.options.initialReconnectDelayMs * 2 ** this.attempts,
      this.options.maxReconnectDelayMs,
    )
    this.attempts += 1
    this.clearTimer()
    this.timer = setTimeout(() => void this.connect(), delay)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
