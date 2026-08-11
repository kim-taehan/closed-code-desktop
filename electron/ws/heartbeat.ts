import { Action, Kind } from '../../shared/protocol/kinds'
import { parseInbound } from '../../shared/protocol/envelope'
import type { Transport, Unsubscribe } from './transport'

// 하트비트만 책임진다 (설계 §4.3).
//
// runtime 은 30초마다 ping 을 보내고 15초 안에 같은 ping_id 로 pong 을 받지 못하면 끊는다.
// pong 은 fast-path 라 reqId 도 data 도 받지 않는다 (api/websocket.py:73-78).
// 응답하지 않으면 약 45초 후 연결이 끊긴다 — M1 필수 항목.

export interface HeartbeatOptions {
  /** ping 이 이 시간 동안 오지 않으면 연결이 죽은 것으로 본다. 0 이면 감시하지 않는다. */
  watchdogMs?: number
  onWatchdogTimeout?: () => void
}

const DEFAULT_WATCHDOG_MS = 90_000 // vscode 실측값: ping 주기 30초의 3배

export class Heartbeat {
  private unsubscribe: Unsubscribe | null = null
  private watchdogTimer: NodeJS.Timeout | null = null

  /** 회신한 pong 개수. 테스트와 진단용. */
  pongsSent = 0
  /** 마지막으로 받은 ping_id */
  lastPingId: string | null = null

  constructor(
    private readonly transport: Transport,
    private readonly options: HeartbeatOptions = {},
  ) {}

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.transport.onMessage((raw) => this.handleMessage(raw))
    this.armWatchdog()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.clearWatchdog()
  }

  private handleMessage(raw: string): void {
    const frame = parseInbound(raw)
    if (!frame || frame.kind !== Kind.SYSTEM || frame.action !== Action.PING) return

    // ping_id 는 별칭이 없어 snake_case 가 정답이다.
    const pingId = (frame as unknown as Record<string, unknown>)['ping_id']
    if (typeof pingId !== 'string') return

    this.lastPingId = pingId
    this.armWatchdog()

    // 봉투 규칙을 타지 않는 fast-path 라 직접 만든다.
    const sent = this.transport.send(JSON.stringify({ kind: Kind.SYSTEM, action: Action.PONG, ping_id: pingId }))
    if (sent) this.pongsSent += 1
  }

  private armWatchdog(): void {
    const timeout = this.options.watchdogMs ?? DEFAULT_WATCHDOG_MS
    this.clearWatchdog()
    if (timeout <= 0) return
    this.watchdogTimer = setTimeout(() => {
      this.options.onWatchdogTimeout?.()
    }, timeout)
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer)
    this.watchdogTimer = null
  }
}
