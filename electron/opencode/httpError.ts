/**
 * 실패한 HTTP 응답을 **사람이 읽을 문구**로 옮긴다.
 *
 * 본문을 그대로 이어 붙이면 화면에 JSON 이 통째로 뜬다. 게이트웨이가 429 를 줄 때
 * 실제로 이렇게 보였다 (2026-08-27 실측):
 *
 *     opencode /session/…/prompt_async 실패: HTTP 429 {"error":{"message":"분당 요청 수 한도(1회)를 넘겼습니다. …","type":"gateway_error"}}
 *
 * 위층은 이 문자열을 **그대로 화면에 그린다** (`translate.ts` → `messageStore` →
 * `TurnEntryView`). 그래서 여기서 문장을 꺼내지 않으면 사용자가 JSON 을 읽게 된다.
 *
 * **모르는 모양이면 원문을 남긴다.** 본문을 통째로 싣던 원래 이유가 진단이었고,
 * 그 몫까지 지우면 낯선 실패를 추적할 근거가 없어진다. 상태 코드도 계속 붙인다.
 */

/** OpenAI 호환 오류(`error.message`)와 opencode 의 두 모양(`data.message`·`message`)을 안다 */
function knownMessage(body: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const record = parsed as Record<string, unknown>
  const nested = (key: string): unknown => {
    const value = record[key]
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)['message'] : undefined
  }

  for (const candidate of [nested('error'), nested('data'), record['message']]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  return null
}

/** `opencode <path> 실패: HTTP <status> <문장 또는 원문>` */
export async function httpFailure(path: string, response: Response): Promise<string> {
  const body = await response.text()
  return `opencode ${path} 실패: HTTP ${response.status} ${knownMessage(body) ?? body}`
}
