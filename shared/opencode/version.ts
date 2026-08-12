// opencode 서버 버전 비교.
//
// **문자열로 비교하면 안 된다** — `'1.9.0' > '1.17.18'` 이 문자열 비교에서는 **참**이라
// 하한선을 그냥 통과한다. 점으로 갈라 숫자로 본다.
//
// `probe.ts` 안에 두지 않은 이유: davis 에는 자동 업데이트가 쓰던
// `shared/update/version.ts` `compareVersions()` 가 있었고 그 기능(A1)은 아직 안 옮겨 왔다.
// 옮겨 올 때 같은 함수가 두 벌이 되지 않게 미리 공용 자리에 둔다.

/**
 * 확인된 opencode 최저 버전. 이 값은 **어댑터를 맞춘 버전**이다 —
 * 1.17.18 과 1.18.16 두 벌에서 API 표면 162경로가 같음을 실측했고
 * (`_workspace/03_contract_qa.md` 13회차), **그 아래는 한 번도 재 본 적이 없다.**
 *
 * 올릴 때는 그 버전으로 `/doc` 을 다시 떠서 실측한 뒤에 올린다 — 숫자만 올리면
 * "맞춰 본 적 없는 버전" 을 맞다고 말하게 된다.
 *
 * **상한은 두지 않는다.** 안 재 본 새 버전을 막으면 사용자가 opencode 를 올릴 때마다
 * 앱이 거짓말을 한다. 우리가 아는 것은 **"이 아래는 위험하다"** 뿐이다.
 */
export const MIN_OPENCODE_VERSION = '1.17.18'

/** a < b 면 음수, 같으면 0, a > b 면 양수. 자리 수가 달라도 짧은 쪽을 0 으로 채운다. */
export function compareVersions(a: string, b: string): number {
  const left = parts(a)
  const right = parts(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** 하한선 이상인가 */
export function meetsMinimum(version: string): boolean {
  return compareVersions(version, MIN_OPENCODE_VERSION) >= 0
}

/**
 * `1.18.0-beta.1` 은 `1.18.0` 과 같게 본다 — 프리릴리스 꼬리를 먼저 떼기 때문이다.
 * opencode 릴리스에서 프리릴리스 태그를 본 적이 없어 **가려 본 적이 없는 경우**이고,
 * 하한선 판정에서는 프리릴리스를 그 기반 버전으로 보는 쪽이 안전하다 (막지 않는다).
 *
 * ⚠️ 꼬리를 안 떼고 점으로만 가르면 `'0-beta'`·`'1'` 이 **버전 자리로 세어져**
 * `1.18.0-beta.1` 이 `1.18.0` 보다 **높다**고 나온다 (자리 수가 하나 늘어난다).
 * 테스트가 잡은 자리다.
 */
function parts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/, '')
    .split(/[-+]/)[0]!
    .split('.')
    .map((piece) => {
      const numeric = Number.parseInt(piece, 10)
      return Number.isNaN(numeric) ? 0 : numeric
    })
}
