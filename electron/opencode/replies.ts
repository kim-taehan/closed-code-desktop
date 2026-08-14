import type { OpencodeClient, PermissionReply } from './client'

// 카드 답신 두 종(도구 승인·ask_user) 을 opencode 호출로 옮긴다.
//
// `transport.ts` 에서 갈라냈다 (300줄 상한). 판단이 아니라 매핑이라 한 덩어리로 묶인다 —
// 둘 다 세션 id 와 요청 id 만 보고, 어댑터의 상태를 건드리지 않는다.
// 세션 계층에도 같은 자리가 있다 (`session/chatResponses.ts`).

/**
 * 승인 응답 매핑.
 *   거부                        → reject
 *   승인 + session/local_allow  → always  (opencode 는 범위 구분이 없다 — 둘 다 always)
 *   승인만                      → once
 */
export async function replyApproval(
  client: OpencodeClient,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const requestId = typeof data['requestId'] === 'string' ? data['requestId'] : ''
  if (!requestId) return
  const approved = data['approved'] === true
  const followUp = data['followUp']
  const reply: PermissionReply = !approved ? 'reject' : followUp ? 'always' : 'once'
  await client.replyPermission(sessionId, requestId, reply)
}

/** ask_user 답신. answer 가 null 이면 거절 경로로 간다 (`client.replyQuestion`). */
export async function replyUserAnswer(
  client: OpencodeClient,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const questionId = typeof data['questionId'] === 'string' ? data['questionId'] : ''
  if (!questionId) return
  const answer = typeof data['answer'] === 'string' ? data['answer'] : null
  await client.replyQuestion(sessionId, questionId, answer)
}
