// 오류를 사람이 읽을 한 줄로. **main 쪽 일곱 곳이 각자 들고 있던 것을 모았다**
// (2026-08-17): `settingsStore`·`opencodeConfig`·`projectStore`·`desktopMcp`·
// `extensionLoader`·`install`·`serviceParse`. 전부 `function describe` 라는 같은 이름에
// 같은 본문이었다.
//
// 한 줄짜리를 굳이 모은 이유는 줄 수가 아니라 **이름이다.** 사본이 일곱이면 읽는 사람은
// 그것들이 정말 같은지 열어 보기 전에는 모르고, 한 곳만 고쳐지면 그 차이가 조용히 산다.
//
// **`describe` 라 부르지 않는다.** vitest 의 전역 `describe` 와 이름이 겹친다 — 어느
// 테스트가 이것을 import 하는 날 그 파일의 `describe` 블록이 조용히 가려진다.
// `serviceParse` 는 이미 `describe` 를 **export** 하고 있어 그 사고가 한 발 앞에 있었다.
//
// ## 함수로 안 감싼 자리는 안 건드린다
//
// 같은 식이 인라인으로 스무 곳 넘게 더 있다 (`{ ok: false, error: error instanceof Error
// ? … }`). 그것들은 **사본이 아니라 관용구다** — 반환 객체 안에서 한 번 쓰이고 끝나 이름이
// 갈릴 여지가 없다. 렌더러(`src/`)에도 같은 식이 있지만 tsconfig 가 갈려 있고, 거기도
// 이름 붙은 헬퍼는 없다.

/** `Error` 면 메시지를, 아니면 있는 그대로. 던져진 것이 무엇이든 문자열이 나온다. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
