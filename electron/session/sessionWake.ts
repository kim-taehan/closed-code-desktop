// 시스템 절전에서 깨어났을 때의 연결 처리.
//
// 절전 중에는 `TCPKeepAlive=active` 로 OS 가 TCP 연결을 살려 둔다. 그래서 깨어난 뒤에도
// **우리 쪽 상태는 여전히 open** 이다. 그런데 상대는 그 침묵을 보고 이미 끊었거나 곧 끊는다
// (runtime ping watchdog → code=4000).
//
// 실측(2026-07-29): 맥이 'Maintenance Sleep' 으로 300초 자고 깨어난 **그 초에** runtime 이
// 끊었다. 절전·복귀는 노트북에서 매일 일어나므로 이 경로는 드문 장애가 아니라 상시 경로다.
//
// 상대가 닫아줄 때까지 기다리면 우리 자체 와치독(90초)까지 늘어질 수 있다. 먼저 버린다.

/** 필요한 것만 요구한다 — WsConnection 전체에 묶이지 않아야 테스트가 쉽다 */
export interface RecyclableConnection {
  readonly isOpen: boolean
  recycle(code?: number, reason?: string): void
}

/**
 * 살아 있다고 믿고 있던 소켓을 버리고 다시 붙는다.
 *
 * `close` 가 아니라 `recycle` 이다 — 수동 종료로 표시되면 재연결이 멈춘다. 새 소켓이
 * 열리면 핸드셰이크가 처음부터 다시 돈다 (handshake.ts 의 onOpen 재무장).
 *
 * **open 일 때만 한다.** 이미 끊겼거나 재연결 중이면 기존 절차가 굴러가는 중이고,
 * 여기서 건드리면 백오프만 흐트러진다.
 */
export function wakeConnection(connection: RecyclableConnection | null): boolean {
  if (!connection?.isOpen) return false
  connection.recycle(4000, 'system resume')
  return true
}
