import type { SessionSlice } from './sessionSlice'
import { isBusy } from './sessionSlice'

// 탭 배지가 보여줄 프로젝트 상태 (설계 §5).
//
// 판정을 한곳에 모으는 이유는 탭·사이드바가 같은 답을 보여야 하기 때문이다.
// 각자 계산하면 어디선가 어긋난다.

export type ProjectStatus =
  /** 목록에는 있으나 아직 연결하지 않음 (지연 연결의 기본) */
  | 'idle'
  /** 연결·핸드셰이크 진행 중 */
  | 'connecting'
  /** 대화 가능 */
  | 'ready'
  /** 턴이 돌거나 승인을 기다리는 중 */
  | 'busy'
  /** 인증 실패·runtime 없음 */
  | 'error'
  /** 소켓이 끊겨 재연결을 기다리는 중 */
  | 'disconnected'

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  idle: '연결 안 됨',
  connecting: '연결 중',
  ready: '준비됨',
  busy: '작업 중',
  error: '오류',
  disconnected: '연결 끊김',
}

/**
 * 상태를 정한다. 순서가 곧 우선순위다.
 *
 * **오류가 바쁨보다 먼저다** — 실패한 세션이 승인 대기를 남겨둔 채 끝나면
 * 바쁨으로 보여 사용자가 끝나기를 기다리게 된다.
 * **끊김이 바쁨보다 먼저인 것도 같은 이유다** — 소켓이 죽었으면 그 턴은 진행되지 않는다.
 */
export function projectStatus(slice: SessionSlice | undefined): ProjectStatus {
  if (slice?.session == null) return 'idle'

  const { handshake, connection } = slice.session
  if (handshake.stage === 'failed') return 'error'
  if (connection === 'reconnecting' || connection === 'closed') return 'disconnected'
  if (handshake.stage !== 'ready') return 'connecting'
  return isBusy(slice) ? 'busy' : 'ready'
}
