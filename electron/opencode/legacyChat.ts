// 레거시 세대로 보내는 채팅 호출 두 건 (프롬프트·중단).
//
// `client.ts` 에서 갈라냈다 (300줄 상한). 왜 레거시 세대인지는 `legacyEvents.ts` 머리말이
// 정본이다 — 요약하면 **신규 v2 경로가 LLM 요청에 MCP 도구를 안 싣기 때문**이고,
// 프롬프트·중단·이벤트 스트림 셋은 세대가 같아야 한다.
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
 */
export async function sendPrompt(post: PostJson, sessionId: string, text: string): Promise<void> {
  await post(`/session/${sessionId}/prompt_async`, { parts: [{ type: 'text', text }] })
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
