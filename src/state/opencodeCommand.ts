// opencode 명령 템플릿 전개.
//
// opencode 는 `/이름 인자` 를 받으면 **명령의 template 을 펼친 글**을 사용자 메시지로
// 만든다 — 실측(1.17.18): `POST /session/:id/command {command:"init", arguments:"PROBE-ARG-XYZ"}`
// 를 넣고 `/api/event` 를 떠 보니 `message.part.updated` 의 본문이 init 템플릿이었고
// `$ARGUMENTS` 자리에 `PROBE-ARG-XYZ` 가 들어가 있었다. 그래서 화면에 뜨는 것도,
// 모델이 받는 것도 **전개된 글**이지 `/init` 이라는 줄이 아니다.
//
// **우리는 그 전개를 여기서 한다.** 서버에 맡기려면 레거시 `POST /session/:id/command` 를
// 써야 하는데, 그 길은 **답이 SSE 에 아예 안 온다.** 사내 LLM 이 붙어 13초에 어시스턴트
// 메시지를 만들어 낸 turn 에서 두 스트림을 동시에 떠서 셌더니 `/api/event` 5건(전부 사용자
// 메시지까지) · `/event` 0건이었고, 답변은 **HTTP 응답 본문에만** 있었다.
// `GET /api/session/:id/message` 로도 0건이다 — v1 이 쓴 것은 v2 읽기 API 에 안 보인다.
// 그래서 전개만 흉내내고 전송은 원래 쓰던 `/api/…/prompt` 로 한다 (README 실측 함정 13).
//
// **못 따라가는 것 (opencode 는 하고 우리는 안 하는 것):**
//   - 템플릿 안의 `!`셸명령`` 실행 결과 삽입 · `@파일` 내용 삽입
//   - `subtask: true` — 별도 에이전트로 도는 명령. 우리는 지금 대화에서 그냥 돈다
//   - 명령이 지정한 `agent`·`model` — 팝업에 태그로 보여만 주고 세션에 걸지는 않는다

// **위치 인자(`$1`·`$2`)도 opencode 의 규칙이다** — MCP 프롬프트 `closed-code-desktop:open` 의
// `hints` 가 `["$1","$2"]` 로 오고, 스킬 `customize-opencode` 의 본문에도 `$1` 이 있다.
// 다만 **우리가 전개하는 갈래(source: 'command')의 템플릿에는 아직 하나도 없어서** 넣지
// 않았다. 그런 템플릿을 만나면 여기에 더한다.
const ARGUMENTS = '$ARGUMENTS'

/**
 * 템플릿의 `$ARGUMENTS` 를 사용자가 이어 친 인자로 바꾼다.
 *
 * `$ARGUMENTS` 가 없는 템플릿에 인자가 오면 **뒤에 덧붙인다.** opencode 가 그 경우
 * 무엇을 하는지는 못 쟀다 — 버리는 쪽과 붙이는 쪽 중 **사용자가 친 글이 사라지지 않는**
 * 쪽을 골랐다.
 */
export function expandTemplate(template: string, args: string): string {
  const trimmed = args.trim()
  if (template.includes(ARGUMENTS)) return template.split(ARGUMENTS).join(trimmed)
  return trimmed === '' ? template : `${template}\n\n${trimmed}`
}
