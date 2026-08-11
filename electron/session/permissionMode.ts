import { createEnvelope, parseInbound, serializeEnvelope } from '../../shared/protocol/envelope'
import { Action, Kind, PermissionMode } from '../../shared/protocol/kinds'
import { HandlerSet, type Transport, type Unsubscribe } from '../ws/transport'

// 권한 모드 전환 (ADR-011 §4).
//
// runtime 은 세션 메모리에만 보관하므로 **연결이 새로 맺어지면 default 로 돌아간다.**
// 그래서 사용자가 고른 값을 여기서 들고 있다가 재연결 후 다시 보낸다 —
// 안 그러면 재연결 한 번에 조용히 default 로 되돌아가 승인 요청이 다시 쏟아진다.
//
// opencode 에서도 같다: 세션을 새로 만들면 에이전트가 기본값(build)이라, plan 으로 두고
// 재연결하면 편집이 열린 채로 돌아간다 — reapply() 가 그것을 막는 자리다.

export class PermissionModeController {
  private desired: PermissionMode = PermissionMode.DEFAULT
  private confirmed: PermissionMode = PermissionMode.DEFAULT
  private unsubscribe: Unsubscribe | null = null

  private readonly changeHandlers = new HandlerSet<[PermissionMode]>()

  constructor(private readonly transport: Transport) {}

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.transport.onMessage((raw) => this.handleMessage(raw))
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.changeHandlers.clear()
  }

  /** 사용자가 고른 값 (아직 확인 안 됐을 수 있다) */
  get current(): PermissionMode {
    return this.desired
  }

  /** runtime 이 확인해 준 값 */
  get acknowledged(): PermissionMode {
    return this.confirmed
  }

  onChange(handler: (mode: PermissionMode) => void): Unsubscribe {
    return this.changeHandlers.add(handler)
  }

  set(mode: PermissionMode): boolean {
    this.desired = mode
    // 응답을 기다리지 않고 화면을 먼저 바꾼다 — 토글이 굼뜨게 느껴지지 않도록.
    // runtime 이 거부하면 permission_mode_changed 로 실제 값이 돌아와 정정된다.
    this.changeHandlers.emit(mode)
    return this.send(mode)
  }

  /**
   * 재연결 후 다시 적용한다.
   * 기본값이면 보낼 필요가 없다 — runtime 도 기본값으로 시작한다.
   */
  reapply(): boolean {
    if (this.desired === PermissionMode.DEFAULT) return true
    return this.send(this.desired)
  }

  private send(mode: PermissionMode): boolean {
    const envelope = createEnvelope(Kind.WORKSPACE, Action.SET_PERMISSION_MODE, { mode })
    return this.transport.send(serializeEnvelope(envelope))
  }

  private handleMessage(raw: string): void {
    const frame = parseInbound(raw)
    if (!frame || frame.kind !== Kind.WORKSPACE) return
    if (frame.action !== Action.PERMISSION_MODE_CHANGED) return

    const mode = (frame.data as Record<string, unknown> | undefined)?.['mode']
    if (!isPermissionMode(mode)) return

    this.confirmed = mode
    if (this.desired !== mode) {
      // runtime 이 다른 값을 확정했다면 그쪽이 정본이다
      this.desired = mode
      this.changeHandlers.emit(mode)
    }
  }
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === PermissionMode.DEFAULT || value === PermissionMode.PLAN
}
