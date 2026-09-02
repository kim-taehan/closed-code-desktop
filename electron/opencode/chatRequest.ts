import { withPromptContext } from './promptContext'
import { toModelRef } from './models'
import type { OpencodeClient } from './client'
import type { SessionModel } from './models'

// `chat_request` 봉투 → opencode 프롬프트.
//
// `transport.ts` 에서 갈라냈다 (300줄 상한 — `workspace.ts` 와 같은 사유). 어댑터에 남은
// 것은 턴을 여는 일(streamId 발급·`stream_start`)이고, **무엇을 어떻게 보내는가**가 여기다.
//
// 턴을 **끊는** 일(`interruptTurn`)도 여기 있다. 같은 턴에 서버로 거는 조작 둘이라
// 갈라 두면 한쪽만 세대가 어긋나도 안 보인다 (실제로 그런 적이 있다 — 아래 ⚠️).

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
  await client.prompt(sessionId, query, imagesFrom(data))
}

/**
 * 돌고 있는 턴을 끊는다 — `POST …/abort` (레거시 세대 — `legacyChat.ts`).
 *
 * ⚠️ **끊었다는 사실이 이벤트로 안 올 수 있다.** 프롬프트 접수 직후 interrupt 는 opencode 가
 * 아무 이벤트도 내지 않는다 (실측). 그래서 부르는 쪽은 「중단을 요청했다」를 스스로 기억하고
 * (`transport.ts` 의 `cancelling`), `translate.ts` 가 그 플래그로 사용자 취소와 프로바이더
 * 실패를 가른다 — 신규 세대는 둘 다 `step.failed` 로만 알려 왔고 구분할 근거가 그것뿐이었다.
 *
 * 지금(레거시)은 그 플래그 없이도 갈린다: 취소가 `MessageAbortedError` 라는 **이름을 달고**
 * 와서 SESSION_ERROR 가 이름만 보고 판단한다. 그래도 플래그를 남기는 것은 STEP_FAILED 가
 * 신규 세대로 되돌릴 때의 자리라서다 (지우면 취소가 빨간 오류로 뜬다).
 */
export async function interruptTurn(client: OpencodeClient, sessionId: string): Promise<void> {
  await client.interrupt(sessionId)
}

/**
 * `chat_request.data.images` 를 뽑아낸다 (davis 계약 `shared/protocol/chatImage.ts`).
 *
 * 망가진 항목은 건너뛴다 — 목록 하나 때문에 질문이 안 나가면 안 된다. 비면 `undefined` 를
 * 돌려 `sendPrompt` 가 `file` part 를 안 붙이게 한다.
 */
function imagesFrom(data: Record<string, unknown>): Array<{ data: string; mediaType: string }> | undefined {
  const raw = data['images']
  if (!Array.isArray(raw)) return undefined
  const images = raw
    .filter(isImage)
    .map((image) => ({ data: image.data, mediaType: image.mediaType }))
  return images.length > 0 ? images : undefined
}

/** base64 · mediaType 이 비어 있으면 그 항목만 버린다. */
function isImage(value: unknown): value is { data: string; mediaType: string } {
  if (value === null || typeof value !== 'object') return false
  const image = value as { data?: unknown; mediaType?: unknown }
  return typeof image.data === 'string' && image.data !== '' && typeof image.mediaType === 'string' && image.mediaType !== ''
}
