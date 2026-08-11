import { HandlerSet, type ConnectionState, type SessionConnection, type Unsubscribe } from '../ws/transport'
import { OpencodeTransport, type OpencodeTransportOptions } from './transport'

// OpencodeTransport 에 **연결 수명**을 씌운 것. WsConnection 과 같은 자리에 선다.
//
// 프레임 번역은 부모(OpencodeTransport)가 하고, 여기는 붙기·버리기·재연결·상태 알림만 안다.
// 나눈 이유는 관심사도 다르지만 300줄 상한도 있다 — 번역기는 앞으로 더 자랄 자리다.

export interface OpencodeConnectionOptions extends OpencodeTransportOptions {
  /** 열릴 때까지 기다리는 한도. WsConnection 실측값과 같게 맞춘다. */
  connectTimeoutMs?: number
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000

export class OpencodeConnection extends OpencodeTransport implements SessionConnection {
  private state: ConnectionState = 'idle'
  private readonly stateHandlers = new HandlerSet<[ConnectionState]>()
  private readonly connectTimeoutMs: number

  constructor(options: OpencodeConnectionOptions) {
    super(options)
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS

    this.onOpen(() => this.setState('open'))
    // SSE 가 끊기면 SseStream 이 스스로 백오프 재연결을 돈다 — 그래서 'closed' 가 아니라
    // 'reconnecting' 이다. 'closed' 로 표시하면 화면이 영구 실패처럼 보인다.
    this.onClose(() => this.setState(this.state === 'closed' ? 'closed' : 'reconnecting'))
  }

  get currentState(): ConnectionState {
    return this.state
  }

  onStateChange(handler: (state: ConnectionState) => void): Unsubscribe {
    return this.stateHandlers.add(handler)
  }

  /** 스트림이 열릴 때까지 기다린다. 한도를 넘기면 거부한다. */
  connect(): Promise<void> {
    if (this.isOpen) return Promise.resolve()
    this.setState('connecting')

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        unsubscribeOpen()
        unsubscribeError()
        this.setState('closed')
        reject(new Error(`opencode 서버에 ${this.connectTimeoutMs}ms 안에 붙지 못했습니다`))
      }, this.connectTimeoutMs)

      const unsubscribeOpen = this.onOpen(() => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsubscribeOpen()
        unsubscribeError()
        resolve()
      })
      // 첫 연결 실패는 화면에 이유를 보여야 한다 — 타임아웃까지 기다리면
      // "서버가 안 떠 있음" 이 "느림" 처럼 보인다.
      const unsubscribeError = this.onError((error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsubscribeOpen()
        unsubscribeError()
        this.setState('closed')
        reject(error)
      })

      this.open()
    })
  }

  /**
   * 살아 있다고 믿던 스트림을 버리고 다시 붙는다.
   *
   * 인자(code/reason)는 `SessionConnection` 계약을 맞추기 위한 것이고 SSE 에는 실을 곳이 없다.
   * 로그로만 남긴다 — 이유가 사라지면 절전 복귀인지 와치독인지 구별이 안 된다.
   */
  recycle(_code = 4000, _reason = 'recycle'): void {
    this.setState('reconnecting')
    this.sse.recycle()
  }

  override close(): void {
    this.setState('closed')
    super.close()
  }

  dispose(): void {
    this.close()
    this.stateHandlers.clear()
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return
    this.state = next
    this.stateHandlers.emit(next)
  }
}
