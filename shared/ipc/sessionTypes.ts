// 핸드셰이크 상태 타입. renderer 도 읽어야 하므로 shared 에 둔다.
// 구현(electron/session/handshake.ts)은 ws 를 끌어오므로 renderer 가 import 할 수 없다.

export type HandshakeStage =
  | 'idle'
  | 'awaiting_connected'
  | 'authenticating'
  | 'syncing_workspace'
  | 'ready'
  | 'failed'

/** WsConnection 의 상태를 그대로 옮긴 것 */
export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface HandshakeFailure {
  stage: HandshakeStage
  reason: string
  code?: string
}

export interface HandshakeState {
  stage: HandshakeStage
  failure?: HandshakeFailure
}

/** 사용자에게 보여줄 단계 이름 */
export const STAGE_LABEL: Record<HandshakeStage, string> = {
  idle: '대기 중',
  awaiting_connected: '연결 중',
  authenticating: '인증 중',
  syncing_workspace: '워크스페이스 동기화 중',
  ready: '연결됨',
  failed: '실패',
}
