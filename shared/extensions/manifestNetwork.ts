// 매니페스트 3판의 `network` — 확장 뒷단이 `code.http.fetch` 로 닿아도 되는 **출처** 목록.
//
// `manifest.ts` 에서 갈라 뒀다 — 저쪽이 300줄 상한에 붙어 있고, 출처를 푸는 규칙은
// 호스트가 부를 때(`electron/extensions/httpFetch.ts`)도 **같은 함수로** 써야 한다.
// 매니페스트에 적은 것과 부르는 주소를 다른 규칙으로 풀면, 같은 출처가 한쪽에서만 맞는다.
//
// **출처(scheme + host + port)만 받는다.** 경로까지 받으면 `https://jira/rest` 를 적은 확장이
// `https://jira/secure/admin` 에 못 닿는다고 읽히는데, 같은 출처 안의 경로를 가르는 것은
// 서버의 권한이지 우리 울타리가 아니다. 거짓 약속을 하지 않으려고 출처 단위로만 판정한다.
//
// 2판은 `network` 가 없다 — 2판 확장은 바깥에 닿지 않는다 (확장 재설계 §8 이 바뀐 것은 3판부터).

/**
 * 주소 하나를 출처로 편다. http(s) 가 아니거나 주소가 아니면 `null`.
 *
 * `URL.origin` 이 기본 포트를 지운다 — `https://jira:443` 와 `https://jira` 는 같은 출처다.
 * 호스트 이름의 대소문자도 여기서 접힌다.
 */
export function originOf(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return url.origin
}

/**
 * 매니페스트의 `network` 를 출처 목록으로. **항목 단위로 거른다** — 명령·뷰와 같은 규칙이다.
 *
 * 버리는 항목: 문자열이 아닌 것 · http(s) 출처가 아닌 것 · **경로·질의·계정이 붙은 것.**
 * 경로가 붙은 것을 출처로 깎아 받지 않는다 — 적은 사람은 그 경로만 열었다고 믿는다 (머리말).
 *
 * 3판이 아니거나 배열이 아니면 `null`(선언 없음 = 어디에도 못 닿는다).
 */
export function toNetwork(value: unknown, manifestVersion: number): string[] | null {
  if (manifestVersion < 3 || !Array.isArray(value)) return null
  const origins = value.flatMap((entry) => {
    if (typeof entry !== 'string') return []
    const origin = originOf(entry)
    return origin !== null && isBareOrigin(entry) ? [origin] : []
  })
  return [...new Set(origins)]
}

/** 출처 말고 붙은 것이 없는가. `new URL('https://jira')` 의 경로는 `/` 라 그것까지는 맨 출처다 */
function isBareOrigin(value: string): boolean {
  const url = new URL(value)
  return url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === ''
}
