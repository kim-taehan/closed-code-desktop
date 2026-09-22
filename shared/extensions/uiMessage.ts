// 확장 화면(웹뷰 탭, 매니페스트 3판)과 확장 뒷단 사이를 오가는 **메시지 한 통의 규칙**.
//
// 세 곳이 같은 규칙을 쓴다 — 확장 호스트(자식)의 `code.ui.post`, main 의 중계, renderer 의
// 탭(iframe 에서 올라온 것). 프로세스 경계마다 다시 거르는 것이 옳고, 규칙이 세 벌이 되면
// 언젠가 한쪽만 바뀐다. 그래서 **판정은 여기 하나**이고 셋이 이것을 부른다.
//
// `shared/` 에 둔다 — renderer 번들에도 실린다. Node 도 electron 도 import 하지 않는다.

/** 한 통의 상한. JSON 으로 편 **바이트 수**로 잰다 (글자 수가 아니다 — 한글은 3바이트다). */
export const UI_MESSAGE_MAX_BYTES = 1024 * 1024

/**
 * 앱이 확장 화면에 보내는 **예약 메시지**의 `type` 접두사.
 *
 * 확장 뒷단이 보내는 메시지는 모양을 앱이 정하지 않는다. 앱이 끼워 보내는 것만 이 접두사로
 * 가른다 — 확장 화면은 `type` 이 이것으로 시작하면 앱이 보낸 것으로 읽으면 된다.
 */
export const APP_MESSAGE_PREFIX = '__app:'

/** 앱 테마의 CSS 변수. 탭이 뜰 때와 테마를 바꿀 때 온다. 쓸지 말지는 확장이 정한다 (E6). */
export const APP_THEME_MESSAGE = '__app:theme'

/**
 * 확장 화면이 올린 메시지를 앱이 **뒷단에 못 건넸다.** 사유가 함께 온다.
 *
 * iframe 의 `postMessage` 는 답이 없는 통로라, 이것이 없으면 너무 큰 메시지·꺼진 확장·
 * 받을 처리기 없음이 전부 「아무 일도 안 일어난다」로만 보인다.
 */
export const APP_REJECTED_MESSAGE = '__app:rejected'

export type UiMessageCheck = { ok: true } | { ok: false; reason: string }

/**
 * 이 값을 확장 화면 메시지로 보내도 되는가.
 *
 * **JSON 만 받는다.** 구조화 복제는 `Date`·`Map`·`undefined`·순환 참조를 통과시키는데, 그런 값은
 * 경계를 한 번 넘을 때마다 모양이 바뀐다 (IPC·utilityProcess·iframe 이 서로 다르게 편다).
 * 확장 개발자는 보낸 것과 받은 것이 다른 이유를 찾지 못한다 — 처음부터 막고 사유를 준다.
 */
export function checkUiMessage(value: unknown): UiMessageCheck {
  const shape = jsonShapeProblem(value, new Set(), '메시지')
  if (shape !== null) return { ok: false, reason: shape }
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length
  if (bytes > UI_MESSAGE_MAX_BYTES) {
    return { ok: false, reason: `메시지가 너무 큽니다 (${bytes}바이트, 상한 ${UI_MESSAGE_MAX_BYTES}바이트)` }
  }
  return { ok: true }
}

/** JSON 으로 그대로 오갈 수 없는 첫 자리를 사람이 읽을 말로. 문제가 없으면 null. */
function jsonShapeProblem(value: unknown, seen: Set<object>, at: string): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${at}: 유한한 수가 아닙니다`
  if (typeof value !== 'object') return `${at}: JSON 값이 아닙니다 (${typeof value})`
  if (seen.has(value)) return `${at}: 순환 참조입니다`
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const problem = jsonShapeProblem(value[index], seen, `${at}[${index}]`)
        if (problem !== null) return problem
      }
      return null
    }
    // 평범한 객체만 — `Date`·`Map`·클래스 인스턴스는 JSON 으로 펴면 다른 것이 된다
    const proto = Object.getPrototypeOf(value) as unknown
    if (proto !== Object.prototype && proto !== null) return `${at}: 평범한 객체가 아닙니다`
    for (const [key, item] of Object.entries(value)) {
      const problem = jsonShapeProblem(item, seen, `${at}.${key}`)
      if (problem !== null) return problem
    }
    return null
  } finally {
    seen.delete(value)
  }
}
