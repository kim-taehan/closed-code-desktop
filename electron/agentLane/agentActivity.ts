// 어시스턴트가 **답하는 도중**에 지나가는 것을 사람이 읽을 한 줄로 만든다.
//
// `askAgent.ts` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았고, 자리도 여기가 맞다:
// 저쪽은 **소켓 하나의 수명**(연결·핸드셰이크·종료)이고 이쪽은 **청크를 사람 말로**다.
//
// 이것은 **답이 아니다.** 확장은 `ask` 의 반환값으로 결론을 받고, 여기 것은 순전히
// 「살아 있다」를 보이기 위한 곁가지다 — 이것을 파싱해 산출물을 만들면 안 된다.

/**
 * 답을 만드는 동안 지나가는 것 한 조각.
 *
 * **답 텍스트가 아니다.** 확장은 여전히 `ask` 의 반환값으로 결론을 받고, 이쪽은 순전히
 * 「살아 있다」를 사람에게 보이려는 곁가지다 — 이것을 파싱해 산출물을 만들면 안 된다.
 */
export interface AgentActivity {
  kind: 'thinking' | 'tool' | 'text'
  /** 사람이 읽을 한 줄. 자르는 것은 여기서 한다 — 화면마다 따로 자르면 기준이 갈린다. */
  text: string
}

/** 활동 한 줄의 길이 상한. 도구 인자는 통째로 오면 화면을 덮는다. */
const ACTIVITY_MAX = 160

/**
 * 활동 한 줄을 부르는 쪽에 넘긴다.
 *
 * **빈 줄은 안 보낸다** — 화면에 빈 칸만 늘고 「무엇을 하는 중인가」를 말해 주지 않는다.
 * 부르는 쪽이 던져도 여기서 삼킨다: 활동 알림이 실패해서 **답 모으기가 끊기면 안 된다.**
 */
export function report(
  onActivity: ((activity: AgentActivity) => void) | undefined,
  kind: AgentActivity['kind'],
  raw: string,
): void {
  if (!onActivity) return
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text === '') return
  try {
    onActivity({ kind, text: text.length > ACTIVITY_MAX ? `${text.slice(0, ACTIVITY_MAX)}…` : text })
  } catch {
    // 곁가지다. 여기서 터져도 질의는 계속돼야 한다
  }
}

/**
 * 도구 호출 한 줄. **인자는 짧게 곁들인다** — 이름만 보이면 `read_file` 이 줄줄이 뜨는데
 * 무엇을 읽는지가 빠져 사람에게는 다 같은 줄이 된다.
 */
export function toolLine(data: Record<string, unknown>): string {
  const name = typeof data['toolName'] === 'string' ? data['toolName'] : '도구'
  const args = data['toolArgs']
  if (args === undefined || args === null) return name
  // 통째로 문자열로 만든다 — 도구마다 인자 이름이 달라 어느 칸을 뽑을지 여기서 못 정한다
  const detail = (typeof args === 'string' ? args : JSON.stringify(args)) ?? ''
  return detail === '' ? name : `${name} ${detail}`
}

