import { parseInbound } from '../../shared/protocol/envelope'
import { Action, Kind } from '../../shared/protocol/kinds'
import { parseNotification, type UserNotification } from '../../shared/protocol/notification'
import { HandlerSet, type Transport, type Unsubscribe } from '../ws/transport'

// 사용자 알림 수신 (kind=notification, action=notify). ADR-053.
//
// AnnouncementController 와 같은 모양이다 — 받아 거르고 알리기만 한다.
// 쌓기·표시·지우기는 화면 몫이다.

export class NotificationController {
  private unsubscribe: Unsubscribe | null = null
  private readonly handlers = new HandlerSet<[UserNotification]>()

  constructor(private readonly transport: Transport) {}

  start(): void {
    this.unsubscribe = this.transport.onMessage((raw) => this.handle(raw))
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.handlers.clear()
  }

  onNotification(handler: (notification: UserNotification) => void): Unsubscribe {
    return this.handlers.add(handler)
  }

  private handle(raw: string): void {
    const frame = parseInbound(raw)
    if (!frame || frame.kind !== Kind.NOTIFICATION || frame.action !== Action.NOTIFY) return

    const notification = parseNotification(frame.data)
    if (notification === null) return

    this.handlers.emit(notification)
  }
}
