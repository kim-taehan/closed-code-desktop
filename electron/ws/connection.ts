import WebSocket from 'ws'
import {
  HandlerSet,
  type CloseInfo,
  type ConnectionState,
  type SessionConnection,
  type Unsubscribe,
} from './transport'

// Transport 의 ws 구현. 연결·해제·재연결만 책임진다. 프로토콜은 모른다.
//
// 재연결은 지수 백오프다. vscode 확장은 고정 3초 × 10회 후 영구 포기라
// 재시작이 30초를 넘는 런타임에서 사용자가 버튼을 누를 때까지 오류 상태로 남는다
// (docs/reference/vscode-behavior/01-chat-and-websocket.md §9 버그 2).
// 여기서는 상한을 둔 지수 백오프로 무기한 재시도한다 — 렌더와 무관한 의도적 개선이다.

export interface ConnectionOptions {
  url: string
  /** 연결 타임아웃. vscode 실측값과 동일 */
  connectTimeoutMs?: number
  initialReconnectDelayMs?: number
  maxReconnectDelayMs?: number
  autoReconnect?: boolean
}

// 상태 타입의 정의는 transport.ts 로 옮겼다 (OpencodeConnection 과 공유). 기존 import 경로 유지용 재수출.
export type { ConnectionState } from './transport'

const DEFAULTS = {
  connectTimeoutMs: 10_000,
  initialReconnectDelayMs: 500,
  maxReconnectDelayMs: 30_000,
  autoReconnect: true,
}

export class WsConnection implements SessionConnection {
  private socket: WebSocket | null = null
  private state: ConnectionState = 'idle'
  private reconnectAttempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private connectTimer: NodeJS.Timeout | null = null
  private manualClose = false

  private readonly openHandlers = new HandlerSet<[]>()
  private readonly messageHandlers = new HandlerSet<[string]>()
  private readonly closeHandlers = new HandlerSet<[CloseInfo]>()
  private readonly errorHandlers = new HandlerSet<[Error]>()
  private readonly stateHandlers = new HandlerSet<[ConnectionState]>()

  private readonly options: Required<ConnectionOptions>

  constructor(options: ConnectionOptions) {
    this.options = { ...DEFAULTS, ...options }
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  get currentState(): ConnectionState {
    return this.state
  }

  /** 지금까지의 재연결 시도 횟수. 테스트와 상태 표시에 쓴다. */
  get attempts(): number {
    return this.reconnectAttempts
  }

  onOpen(handler: () => void): Unsubscribe {
    return this.openHandlers.add(handler)
  }

  onMessage(handler: (raw: string) => void): Unsubscribe {
    return this.messageHandlers.add(handler)
  }

  onClose(handler: (info: CloseInfo) => void): Unsubscribe {
    return this.closeHandlers.add(handler)
  }

  onError(handler: (error: Error) => void): Unsubscribe {
    return this.errorHandlers.add(handler)
  }

  onStateChange(handler: (state: ConnectionState) => void): Unsubscribe {
    return this.stateHandlers.add(handler)
  }

  send(payload: string): boolean {
    if (!this.isOpen) return false
    this.socket!.send(payload)
    return true
  }

  /** 연결을 시작한다. open 될 때까지 기다린다. 실패하면 던진다. */
  async connect(): Promise<void> {
    if (this.state === 'open' || this.state === 'connecting') return
    this.manualClose = false
    await this.openSocket()
  }

  close(code = 1000, reason = 'manual close'): void {
    this.manualClose = true
    this.clearTimers()
    this.setState('closed')
    this.socket?.close(code, reason)
    this.socket = null
  }

  /**
   * 소켓을 버리되 재연결은 계속한다.
   *
   * close() 는 수동 종료로 표시돼 재연결이 멈춘다.
   * ping 와치독처럼 "연결이 죽은 것 같으니 다시 붙어라" 인 경우엔 이쪽을 쓴다.
   */
  recycle(code = 4000, reason = 'recycle'): void {
    // manualClose 를 건드리지 않는다 — close 핸들러가 재연결을 건다
    this.socket?.close(code, reason)
  }

  private openSocket(): Promise<void> {
    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.options.url)
      this.socket = socket
      let settled = false

      this.connectTimer = setTimeout(() => {
        if (settled) return
        settled = true
        socket.terminate()
        reject(new Error(`연결 타임아웃 (${this.options.connectTimeoutMs}ms): ${this.options.url}`))
      }, this.options.connectTimeoutMs)

      socket.on('open', () => {
        this.clearConnectTimer()
        this.reconnectAttempts = 0
        this.setState('open')
        this.openHandlers.emit()
        if (!settled) {
          settled = true
          resolve()
        }
      })

      socket.on('message', (raw) => this.messageHandlers.emit(raw.toString()))

      socket.on('error', (error) => {
        this.errorHandlers.emit(error instanceof Error ? error : new Error(String(error)))
        // close 가 뒤따르지 않는 error 도 있으므로 여기서도 재연결을 건다.
        // vscode 는 error 경로에서 재연결하지 않아 소켓이 방치되는 경우가 있다 (같은 문서 §9 버그 3).
        if (!settled) {
          settled = true
          this.clearConnectTimer()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })

      socket.on('close', (code, reasonBuffer) => {
        this.clearConnectTimer()
        const info: CloseInfo = { code, reason: reasonBuffer.toString() }
        this.socket = null
        if (this.state !== 'closed') this.setState('closed')
        this.closeHandlers.emit(info)
        if (!this.manualClose && this.options.autoReconnect) this.scheduleReconnect()
      })
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = this.nextDelay()
    this.reconnectAttempts += 1
    this.setState('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.openSocket().catch((error: unknown) => {
        this.errorHandlers.emit(error instanceof Error ? error : new Error(String(error)))
        // openSocket 이 close 없이 실패한 경우(타임아웃 등)에도 다음 시도를 건다.
        if (!this.manualClose && this.options.autoReconnect && !this.reconnectTimer) {
          this.scheduleReconnect()
        }
      })
    }, delay)
  }

  /** 지수 백오프: initial × 2^attempts, max 로 상한 */
  nextDelay(): number {
    const raw = this.options.initialReconnectDelayMs * 2 ** this.reconnectAttempts
    return Math.min(raw, this.options.maxReconnectDelayMs)
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    this.stateHandlers.emit(state)
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.connectTimer = null
  }

  private clearTimers(): void {
    this.clearConnectTimer()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  dispose(): void {
    this.close()
    this.openHandlers.clear()
    this.messageHandlers.clear()
    this.closeHandlers.clear()
    this.errorHandlers.clear()
    this.stateHandlers.clear()
  }
}
