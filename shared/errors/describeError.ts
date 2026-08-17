// 오류를 사람이 읽을 한 줄로. **레포에 서른 벌 가까이 흩어져 있던 것을 모았다** (2026-08-17).
//
// 두 걸음으로 왔다. 먼저 `function describe` 라는 같은 이름에 같은 본문인 사본 일곱을
// 모았고(`settingsStore`·`opencodeConfig`·`projectStore`·`desktopMcp`·`extensionLoader`·
// `install`·`serviceParse`), 그다음 **인라인으로 쓰던 스물두 곳**을 이리로 돌렸다.
//
// 인라인은 처음에 「사본이 아니라 관용구」로 판정하고 남겼는데, 그 판정이 약했다 —
// `{ ok: false, error: error instanceof Error ? error.message : String(error) }` 는
// 반환값의 모양을 읽으려는 사람에게 **잡음**이다. 이름이 붙으면 그 줄이 말하려는 것만 남는다.
//
// **`describe` 라 부르지 않는다.** vitest 의 전역 `describe` 와 이름이 겹친다 — 어느
// 테스트가 이것을 import 하는 날 그 파일의 `describe` 블록이 조용히 가려진다.
// `serviceParse` 는 이미 `describe` 를 **export** 하고 있어 그 사고가 한 발 앞에 있었다.
//
// **`shared/` 에 있는 이유는 렌더러도 쓰기 때문이다** — `ErrorPage`·`useExtensionPanel`
// 등 다섯 곳. 처음엔 `electron/errors/` 에 뒀는데 main 만 쓰는 줄 알았고, 그것이 틀렸다.
//
// ⚠️ **`opencode/probe.ts` 의 동명 함수는 여기 없다.** 본문이 다르다 — `AbortError` 를
// "응답이 없습니다" 로 바꿔 읽는 갈래가 있어, 합치면 그 문장이 사라진다. 일괄 개명이
// 그 자리까지 훑어서 되돌린 적이 있으니 다음에도 그대로 두라.

/** `Error` 면 메시지를, 아니면 있는 그대로. 던져진 것이 무엇이든 문자열이 나온다. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
