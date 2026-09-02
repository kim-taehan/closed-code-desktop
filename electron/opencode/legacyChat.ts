// 레거시 세대로 보내는 호출 네 건 (프롬프트·중단·승인 응답·질문 응답).
//
// `client.ts` 에서 갈라냈다 (300줄 상한). 왜 레거시 세대인지는 `legacyEvents.ts` 머리말이
// 정본이다 — 요약하면 **신규 v2 경로가 LLM 요청에 MCP 도구를 안 싣기 때문**이다.
//
// ⚠️ **다섯이 한 세트다 — 하나만 남겨 두면 조용히 반쯤 죽는다.**
//
//   프롬프트  POST /session/:id/prompt_async      (신규 `/api/session/:id/prompt` 아님)
//   중단      POST /session/:id/abort             (신규 `/api/session/:id/interrupt` 아님)
//   승인 응답 POST /session/:id/permissions/:pid  (신규 `…/permission/:rid/reply` 아님)
//   질문 응답 POST /question/:rid/reply           (신규 `…/question/:rid/reply` 아님)
//   이벤트    GET  /event                         (신규 `/api/event` 아님 — `client.ts` 의 `eventUrl`)
//
// 처음엔 앞의 셋만 옮겼고 승인·질문 응답이 신규로 남아 **카드는 뜨는데 눌러도 아무 일이
// 없는** 상태를 만들었다 (contract-qa 교차 대조에서 잡혔다). 원인은 하나다:
// **한쪽 세대가 올린 요청은 다른 세대의 목록에 아예 안 보인다.** 같은 시각·같은 세션에서
// `GET /permission` 에는 있는 승인이 `GET /api/session/:id/permission` 에는 `[]` 다.
//
// 받는 쪽(`legacyEvents.ts`)과 짝이다. 한쪽만 세대를 바꾸면 조용히 반쯤 죽는다.

/** `OpencodeClient.post` 를 그대로 받는다 — URL 조립·인증·`{data}` 벗기기는 거기 규칙을 따른다. */
export type PostJson = (path: string, body: unknown) => Promise<unknown>

/**
 * 프롬프트를 보낸다.
 *
 * 실측(1.18.18): 턴 완료를 기다리지 않고 **접수 즉시 204 로 반환**한다(10ms).
 * 턴의 진행·결과는 전부 SSE(`/event`)로 온다 — 여기서 답을 꺼내려 하지 말 것.
 *
 * **본문은 `parts` 하나면 된다.** 스키마상 필수도 그것뿐이고(`/doc` 의 `session.prompt`),
 * `model` 과 `?directory=` 는 **일부러 안 싣는다** — 세션이 이미 둘 다 알고 있어서다.
 * 최소 본문으로 넣은 턴의 LLM 요청에 MCP 도구가 그대로 실린 것을 캡처로 확인했다.
 * 모델 오버라이드는 `models.ts` 가 보내기 직전에 세션에 걸므로, 여기에 또 실으면
 * 진실의 출처가 둘이 된다.
 *
 * ⚠️ **`/session/:id/message` 도 같은 레거시 프롬프트지만 쓰지 않는다.** 그쪽은 턴이
 * **끝나야** 200 을 주고(본문이 완성된 어시스턴트 메시지다), `prompt_async` 는 같은
 * 본문에 204 를 즉시 준다 (실측 10ms 대 1909ms). 어댑터는 진행을 전부 SSE 로 받으므로
 * 응답 본문에 쓸 것이 없고, 턴 내내 HTTP 요청을 붙들 이유도 없다. 둘 다 `tools` 에
 * MCP 도구를 싣는 것은 같은 캡처에서 확인했다.
 *
 * **이미지는 `file` part 로 실는다 (`data:` URI).** 스키마 `FilePartInput` 의 필수 셋은
 * `type:'file'` · `mime` · `url` 이고, `url` 이 곧 `data:<mime>;base64,…` 이다 — `source` 는
 * 불필요하다(이것을 `prompt.files` 로 보내면 `provider 가 media type 을 거절한다` 는
 * `promptContext.ts` 의 실측과 다르지 않다. 같은 `data:` URI 를 `url` 로 주면 통한다).
 * `promptContext.ts` 의 `glm-5.2`(비전 없음) 주석은 2026-08-28에 그 모델이 종료된 이후
 * **낡았다** — 기본 모델 `gateway-local/qwen3.8-27b` 은 이미지 입력을 받는다
 * (`desktop/CLAUDE.md` 모델 표).
 */
export async function sendPrompt(
  post: PostJson,
  sessionId: string,
  text: string,
  images?: Array<{ data: string; mediaType: string }>,
): Promise<void> {
  const parts: Array<Record<string, unknown>> = [{ type: 'text', text }]
  for (const image of images ?? []) {
    parts.push({ type: 'file', mime: image.mediaType, url: `data:${image.mediaType};base64,${image.data}` })
  }
  await post(`/session/${sessionId}/prompt_async`, { parts })
}

/**
 * 진행 중인 턴을 끊는다 (davis stream_cancel 대응).
 *
 * ⚠️ **레거시 턴은 레거시로만 끊긴다.** 레거시 프롬프트로 돈 턴에
 * `POST /api/session/:id/interrupt` 를 넣으면 **아무 일도 안 일어난다** — 204 는
 * 돌아오는데 델타가 계속 흐르고 `session.idle` 이 끝내 안 온다 (1.18.18 실측).
 * 조용히 무시되므로 증상은 "중단 버튼이 안 먹는다" 뿐이다.
 *
 * 레거시 abort 는 **200 에 본문 `true`** 이고, 뒤이어 SSE 로 이 셋이 온다:
 *   `session.error{error:{name:"MessageAbortedError"}}` → `session.status{idle}` → `session.idle`
 * 첫 건을 오류로 옮기면 사용자가 스스로 끊은 자리에 빨간 오류가 뜬다 — 가르는 것은
 * `translate.ts` 의 SESSION_ERROR 분기다.
 *
 * 신규 경로에서 `step.ended` 가 끝내 안 와 TurnGate 의 5초 강제 종단에 기대던 문제는
 * 레거시엔 없다 — `session.idle` 이 실제로 온다.
 */
export async function abortTurn(post: PostJson, sessionId: string): Promise<void> {
  await post(`/session/${sessionId}/abort`, {})
}

/**
 * 도구 승인 응답. 보내지 않으면 턴이 그 자리에서 멈춘다.
 *
 * ⚠️ **승인도 세대가 갈린다 — 레거시 턴이 올린 승인은 레거시 목록에만 있다** (실측):
 *
 *   GET /permission                        → 대기 중인 승인이 보인다
 *   GET /api/session/:id/permission        → `{"data":[]}`  (같은 시각·같은 세션)
 *   POST /api/session/:id/permission/:rid/reply → **404 PermissionNotFoundError**
 *
 * 만료가 아니다 — 404 를 받은 뒤에도 그 승인은 `GET /permission` 에 계속 살아 있다.
 * 증상이 고약하다: 승인 카드는 **정상적으로 뜨는데** 사용자가 "허용" 을 눌러도 아무 일도
 * 안 일어나고 턴이 영원히 멈춘다. 도구 승인을 켠 사용자는 채팅이 통째로 죽는다.
 *
 * ⚠️ **본문 키가 `reply` 가 아니라 `response` 다.** 값 셋(`once`·`always`·`reject`)은
 * 두 세대가 같아서 타입은 그대로 쓴다 — 키 이름만 다르다. 경로도 `permissions`(복수)이고
 * 끝에 `/reply` 가 없다.
 *
 * 실측: 이 호출 → `200 true` → 도구가 `running → completed` 로 진행 → `session.idle`.
 */
export async function replyPermissionLegacy(
  post: PostJson,
  sessionId: string,
  requestId: string,
  response: string,
): Promise<void> {
  await post(`/session/${sessionId}/permissions/${requestId}`, { response })
}

/**
 * 질문(ask_user) 답신. `answer` 가 null 이면 거절 경로로 간다.
 *
 * ⚠️ **여기도 세대가 갈리는데, 승인보다 더 조용히 실패한다.** 신규 경로는 404 가 아니라
 * **400** 을 준다 — 본문 검증이 먼저 걸려서, 세대가 틀렸다는 사실 자체를 안 알려준다:
 *
 *   GET /question                       → 대기 중인 질문이 보인다
 *   GET /api/session/:id/question       → `{"data":[]}`
 *   POST /api/session/:id/question/:rid/reply  {text}  → **400 `Missing key at ["answers"]`**
 *
 * ⚠️ **본문이 `{text}` 가 아니라 `{answers}` 이고, 답 하나가 배열이다** — `QuestionAnswer`
 * 가 `string[]` 이라 질문 하나에 답 하나면 `[[답]]` 이 된다 (질문마다 하나씩, 순서대로).
 *
 * **세션 id 를 안 쓴다** — 레거시 질문 표면은 요청 id 하나로 찾는다. 거절은 본문이 없다.
 *
 * 한계: davis 의 질문 카드는 질문 하나에 답 하나라, 여러 질문이 한 번에 온 경우 첫 질문에만
 * 답한다. 실측한 것도 질문 하나짜리다 — 여럿이 오는 경우를 만나면 여기서 넓힌다.
 */
export async function replyQuestionLegacy(
  post: PostJson,
  requestId: string,
  answer: string | null,
): Promise<void> {
  if (answer === null) return void (await post(`/question/${requestId}/reject`, {}))
  await post(`/question/${requestId}/reply`, { answers: [[answer]] })
}
