// 세션 계층(session/*)이 의존하는 소켓 인터페이스.
// 설계 §10 DIP: session 은 이 인터페이스만 알고 ws 라이브러리를 직접 쓰지 않는다.
// 가짜 서버 테스트와 실제 연결이 같은 코드 경로를 타게 하는 것이 목적이다.

export type Unsubscribe = () => void

export interface CloseInfo {
  code: number
  reason: string
}

export interface Transport {
  /** 지금 프레임을 보낼 수 있는 상태인가 */
  readonly isOpen: boolean
  /** 프레임 전송. 열려 있지 않으면 false 를 돌려주고 던지지 않는다. */
  send(payload: string): boolean
  onOpen(handler: () => void): Unsubscribe
  onMessage(handler: (raw: string) => void): Unsubscribe
  onClose(handler: (info: CloseInfo) => void): Unsubscribe
  onError(handler: (error: Error) => void): Unsubscribe
  close(code?: number, reason?: string): void
}

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

/**
 * 세션 계층(sessionWiring·ProjectSession·sessionWake)이 실제로 요구하는 **수명** API.
 *
 * `Transport` 는 프레임만 안다. 붙기·버리기·재연결·상태 알림은 그 위 계층이다.
 *
 * 원래는 `WsConnection`(davis) 과 `OpencodeConnection`(opencode) **둘 다**가 이걸
 * 만족했고, 배선이 어느 쪽을 쓰든 위층 코드가 같아지는 것이 이 인터페이스의 값이었다.
 * 2026-08-26 에 davis 쪽 구현을 지웠다 — 앱에 davis WS 를 여는 곳이 없어졌기 때문이다.
 * **그래도 이 자리는 남는다.** 지금 프로덕션 구현은 `OpencodeConnection` 하나지만,
 * 세션 계층의 컨트롤러·핸드셰이크·채팅이 이 인터페이스만 알기에 시험이
 * `tests/runtime-protocol/MemoryConnection`(인메모리 대역)으로 같은 코드 경로를 돌린다.
 * 갈아끼울 자리가 실제로 갈아끼워진 셈이다. **구체 구현을 이름으로 아는 곳은
 * `session/sessionWiring.ts` 하나뿐이다** — 조립은 어차피 구체를 불러야 해서다.
 */
export interface SessionConnection extends Transport {
  /** 열릴 때까지 기다린다. 실패하면 거부한다. */
  connect(): Promise<void>
  /** 살아 있다고 믿던 연결을 버리고 다시 붙는다 (수동 종료로 표시하지 않는다) */
  recycle(code?: number, reason?: string): void
  dispose(): void
  onStateChange(handler: (state: ConnectionState) => void): Unsubscribe
}

/** 핸들러 집합을 관리하는 최소 구현. 각 Transport 구현이 재사용한다. */
export class HandlerSet<TArgs extends unknown[]> {
  private handlers = new Set<(...args: TArgs) => void>()

  add(handler: (...args: TArgs) => void): Unsubscribe {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  emit(...args: TArgs): void {
    for (const handler of [...this.handlers]) handler(...args)
  }

  clear(): void {
    this.handlers.clear()
  }
}
