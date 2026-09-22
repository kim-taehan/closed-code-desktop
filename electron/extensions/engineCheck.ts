// 확장이 요구하는 호스트 API 판(`manifest.engines.code`)을 이 호스트가 채우는가.
//
// 확장이 **별도 레포**(`desktop-extensions/`)로 갈라 나가면서 필요해졌다 (2026-09-22). 두 레포는
// 따로 움직이므로, 호스트가 모르는 API 를 부르는 확장이 실리면 **실행 중에야** 터진다. 싣기 전에
// 거른다. 그 전까지 `engines` 는 파싱만 되고 판정하는 곳이 없었다.
//
// **npm 표기를 다 풀지 않는다.** 쓰는 것은 `^x.y.z` 와 정확한 판 둘뿐이라 그만 받는다. 모르는
// 표기는 **싣지 않는다** — 통과시키면 이 판정이 있는 이유가 사라진다. `engines` 가 아예 없는
// 확장은 예전처럼 싣는다 (판을 말하지 않은 것은 판을 어긴 것이 아니다).

/**
 * 이 호스트가 확장에게 주는 API 의 판. **API 를 바꾸면 올린다** — 올리지 않으면 이 판정은
 * 아무것도 거르지 않는다. 0.x 에서는 minor 가 곧 호환 경계다 (npm `^0.y` 규칙).
 */
export const EXTENSION_API_VERSION = '0.1.0'

type Version = [number, number, number]

/** `range` 가 `version` 을 받아들이는가. 모르는 표기면 false. */
export function satisfiesEngine(range: string, version: string = EXTENSION_API_VERSION): boolean {
  const host = parse(version)
  if (host === null) return false

  const caret = range.trim().startsWith('^')
  const want = parse(caret ? range.trim().slice(1) : range.trim())
  if (want === null) return false
  if (!caret) return compare(host, want) === 0

  // ^x.y.z — 가장 왼쪽의 0 아닌 자리가 같고, 그 이상이어야 한다 (npm 규칙)
  const [major, minor] = want
  const sameLane = major > 0 ? host[0] === major : minor > 0 ? host[0] === 0 && host[1] === minor : compare(host, want) === 0
  return sameLane && compare(host, want) >= 0
}

function parse(text: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text)
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}
