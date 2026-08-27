import { Action, Kind } from '../../shared/protocol/kinds'
import type { ServerFrame } from './turnScript'

// 가짜 서버의 diff(턴 리뷰) 도메인.
// 판정을 받으면 실제 runtime 처럼 turn_status 로 결과를 돌려준다.

export function buildTurnDecisionReply(
  action: string,
  reqId: string,
  data?: Record<string, unknown>,
): ServerFrame[] {
  if (action !== Action.TURN_ACK && action !== Action.TURN_REJECT) return []

  const turnId = String(data?.['turnId'] ?? '')
  if (!turnId) {
    return [
      {
        kind: Kind.DIFF,
        action: Action.ERROR,
        replyTo: reqId,
        data: { code: 'BAD_REQUEST', message: 'turnId 필수' },
      },
    ]
  }

  return [
    {
      kind: Kind.DIFF,
      action: Action.TURN_STATUS,
      replyTo: reqId,
      data: {
        turnId,
        status: action === Action.TURN_ACK ? 'ACCEPTED' : 'REJECTED',
        isFinalized: true,
        files: [],
        // 부분 거부면 어떤 파일이었는지 되돌려준다
        ...(Array.isArray(data?.['filePaths']) ? { filePaths: data['filePaths'] } : {}),
      },
    },
  ]
}

/** turn_changes 푸시 프레임을 만든다 (replyTo 없음 — 실제와 동일) */
export function turnChangesFrame(review: Record<string, unknown>): ServerFrame {
  return { kind: Kind.DIFF, action: Action.TURN_CHANGES, data: review }
}
