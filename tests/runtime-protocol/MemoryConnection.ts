import {
  HandlerSet,
  type CloseInfo,
  type ConnectionState,
  type SessionConnection,
  type Unsubscribe,
} from '../../electron/ws/transport'
import { FakeRuntimeProtocol, type FakeRuntimeOptions } from './runtimeProtocol'
import type { ServerFrame } from './turnScript'

// `SessionConnection` 의 **인메모리 대역.** 소켓 없이 프레임만 오간다.
//
// 세션 계층(`session/*`)은 설계 §10 DIP 로 `electron/ws/transport.ts` 의 인터페이스만
// 알고 전송 수단을 모른다 — 그 성질이 여기서 값을 낸다. 예전에는 이 자리를
// `WsConnection` + 진짜 WebSocket 서버가 채웠는데, 앱이 opencode(HTTP+SSE)로 옮겨가며
// davis WS 를 여는 프로덕션 코드가 사라져 **전송만 죽고 프레임 계약은 살아남았다.**
// 그래서 전송을 들어내고 인터페이스 자리에 이걸 끼운다 (2026-08-26).
//
// 잃은 것을 분명히 적어 둔다: 소켓이 없으므로 **재연결·지수 백오프·연결 타임아웃·
// csid 쿼리는 여기서 못 잰다.** 그것들은 `WsConnection` 고유의 성질이었고 함께 삭제됐다
// (프로덕션 호출자가 없다). 지금 재는 것은 그 위, 프레임이 오갈 때의 세션 계층 행동이다.
//
// **전달은 비동기다 (마이크로태스크).** 처음에는 동기로 짰다가 시험 셋이 깨져서 고쳤고,
// 그 셋이 왜 깨졌는지가 이 결정의 근거다:
//
//  - 「불러오는 동안 loading 이 true 다」 — 동기로 답하면 요청이 돌아오기 전의 중간 상태가
//    아예 존재하지 않는다. 시험이 겨누던 그 상태를 대역이 지워 버린다.
//  - 「모르는 값은 BAD_REQUEST 로 거부한다」 — `send()` 안에서 곧바로 답이 올라와,
//    보낸 쪽이 대기 항목을 등록하기도 전에 응답이 도착한다 (재진입).
//
// 진짜 소켓은 I/O 라 매크로태스크지만 여기서는 마이크로태스크로 충분하다 — 보낸 자리와
// 받는 자리를 갈라 놓는 것이 요점이고, 시험은 그대로 빠르다. 순서는 보존된다.

export class MemoryConnection implements SessionConnection {
  private state: ConnectionState = 'idle'
  private opened = false

  private readonly openHandlers = new HandlerSet<[]>()
  private readonly messageHandlers = new HandlerSet<[string]>()
  private readonly closeHandlers = new HandlerSet<[CloseInfo]>()
  private readonly errorHandlers = new HandlerSet<[Error]>()
  private readonly stateHandlers = new HandlerSet<[ConnectionState]>()

  /** 상대편. 시험이 `received` 를 단언하고 `push` 로 프레임을 밀어 넣는다. */
  readonly runtime: FakeRuntimeProtocol

  constructor(options: FakeRuntimeOptions = {}) {
    this.runtime = new FakeRuntimeProtocol(options, (frame) => {
      // 서버가 내보낸 프레임이 클라이언트에게 도착하는 자리.
      // 직렬화는 지금 한다 — 나중에 하면 프레임을 밀어 넣은 쪽이 그 뒤에 고친 것까지 실린다.
      const raw = JSON.stringify(frame)
      queueMicrotask(() => {
        if (this.opened) this.messageHandlers.emit(raw)
      })
    })
  }

  get isOpen(): boolean {
    return this.opened
  }

  get currentState(): ConnectionState {
    return this.state
  }

  async connect(): Promise<void> {
    this.opened = true
    this.setState('open')
    this.openHandlers.emit()
    // 붙자마자 서버가 먼저 보내는 connected 프레임 — 핸드셰이크 1단계가 이걸 기다린다
    this.runtime.greet()
  }

  send(payload: string): boolean {
    if (!this.opened) return false
    this.runtime.handle(payload)
    return true
  }

  /** 상대편이 임의 프레임을 밀어넣는다 (`runtime.push` 로 가는 지름길) */
  push(frames: ServerFrame[]): void {
    this.runtime.push(frames)
  }

  /** 상대가 사라진다 — 턴 도중 끊김을 만드는 자리 (예전의 `server.stop()`) */
  drop(code = 1006, reason = 'runtime gone'): void {
    if (!this.opened) return
    this.opened = false
    this.setState('closed')
    this.closeHandlers.emit({ code, reason })
  }

  close(code = 1000, reason = 'manual'): void {
    this.drop(code, reason)
  }

  recycle(code = 1012, reason = 'recycle'): void {
    this.drop(code, reason)
  }

  dispose(): void {
    this.opened = false
    this.setState('closed')
    this.openHandlers.clear()
    this.messageHandlers.clear()
    this.closeHandlers.clear()
    this.errorHandlers.clear()
    this.stateHandlers.clear()
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

  private setState(next: ConnectionState): void {
    if (this.state === next) return
    this.state = next
    this.stateHandlers.emit(next)
  }
}
