import { withPromptContext } from './promptContext'
import { toModelRef } from './models'
import type { OpencodeClient } from './client'
import type { SessionModel } from './models'

// `chat_request` 봉투 → opencode 프롬프트.
//
// `transport.ts` 에서 갈라냈다 (300줄 상한 — `workspace.ts` 와 같은 사유). 어댑터에 남은
// 것은 턴을 여는 일(streamId 발급·`stream_start`)이고, **무엇을 어떻게 보내는가**가 여기다.

/**
 * 프롬프트를 조립해 보낸다.
 *
 * **부르는 쪽이 await 하지 않는다.** 이 호출은 턴이 끝나야 돌아오므로 await 하면 그동안
 * 도착하는 취소·승인 프레임을 처리할 수 없다 — 화면 갱신은 SSE 가 한다 (`transport.ts`).
 *
 * 모델 오버라이드는 **보내기 직전에** 세션에 건다. davis 는 요청마다 실어 보냈고 runtime 이
 * 기억하지 않았지만, opencode 의 모델은 세션에 남는다 — 그래서 오버라이드가 빠진 요청에서는
 * 기본 모델로 되돌린다. 안 되돌리면 한 번 고른 모델이 영영 붙는다 (`models.ts`).
 */
export async function sendChatRequest(
  client: OpencodeClient,
  model: SessionModel,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  // 붙인 문서·보는 파일은 글로 번역해 함께 보낸다 — 안 하면 사라진다 (`promptContext.ts`)
  const query = withPromptContext(typeof data['query'] === 'string' ? data['query'] : '', data)
  const requested = typeof data['model'] === 'string' ? toModelRef(data['model']) : null
  await model.apply(sessionId, requested)
  await client.prompt(sessionId, query)
}
