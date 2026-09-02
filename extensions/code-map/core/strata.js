// 파일들을 **층**으로 가른다. 「이 아키텍처가 실제로 서 있나」를 재는 자리다.
//
// 헥사고날에서 의존은 **안쪽으로만** 흘러야 한다 — adapter 는 application 을 알아도 되지만
// domain 은 바깥을 몰라야 한다. 그 규칙이 지켜지는지는 간선의 **방향**으로만 재진다.
//
// ⚠️ **모든 프로젝트가 헥사고날인 것은 아니다.** 이름 셋을 못 찾으면 층을 지어내지 않고
// 최상위 디렉토리로 가른다. 그때는 안팎이 없으므로 **위반도 판정하지 않는다** —
// 없는 규칙을 어겼다고 말하는 것이 규칙을 안 재는 것보다 나쁘다.

/** 안쪽 → 바깥. 이 순서가 곧 「무엇이 무엇을 알아도 되는가」다 */
const RINGS = ['domain', 'application', 'adapter']

const OUTSIDE = '기타'

/**
 * 링 이름이 경로에 마디로 들어 있나. `mydomain/` 은 `domain` 이 아니다 —
 * 부분 일치로 재면 엉뚱한 파일이 도메인으로 들어온다
 */
function ringOf(path) {
  for (const ring of RINGS) {
    if (new RegExp(`(^|/)${ring}(/|$)`).test(path)) return ring
  }
  return null
}

/** `a/b/c.ts` → `a`. 링을 못 찾았을 때 쓰는 갈래 */
function topDir(path) {
  const cut = path.indexOf('/')
  return cut < 0 ? path : path.slice(0, cut)
}

/**
 * 이 프로젝트를 어떻게 층으로 볼 것인가.
 *
 * **셋 중 둘 이상**이 있어야 헥사고날로 본다. 하나만 있으면 우연히 `domain` 이라는 폴더가
 * 있는 것일 수 있고, 그 하나로 판을 뒤집으면 나머지 파일이 전부 「기타」가 되어 화면이
 * 거짓말을 한다.
 *
 * @returns `{ mode, order, of, note }` — `order` 는 **바깥부터** (화면에 쌓는 순서),
 *          `of` 는 경로 → 층 이름, `note` 는 화면에 그대로 적을 한 줄
 */
function layerModel(paths) {
  const found = new Set()
  for (const path of paths) {
    const ring = ringOf(path)
    if (ring) found.add(ring)
  }

  if (found.size >= 2) {
    const of = new Map(paths.map((p) => [p, ringOf(p) ?? OUTSIDE]))
    const order = [...RINGS].reverse().filter((r) => found.has(r))
    if ([...of.values()].includes(OUTSIDE)) order.push(OUTSIDE)
    return { mode: 'hexagonal', order, of, note: '의존은 안쪽으로만 흘러야 합니다' }
  }

  const of = new Map(paths.map((p) => [p, topDir(p)]))
  const order = [...new Set(of.values())].sort()
  return {
    mode: 'directory',
    order,
    of,
    // 안팎이 없다는 사실을 **화면이 말한다.** 안 적으면 위반이 0인 것과 구분되지 않는다
    note: '헥사고날 층 이름을 못 찾아 최상위 폴더로 갈랐습니다 — 방향은 재지 않습니다',
  }
}

/**
 * **안쪽이 바깥을 수입하는 자리.** 헥사고날일 때만 판정한다.
 *
 * 수입과 상속을 함께 본다 — 도메인이 어댑터를 상속하는 것도 같은 위반이다.
 * `기타` 는 어느 쪽으로도 세지 않는다: 층을 모르는 것과 층을 어긴 것은 다르다.
 */
function violations(graph, model) {
  if (model.mode !== 'hexagonal') return []
  const rank = (path) => RINGS.indexOf(model.of.get(path) ?? OUTSIDE)
  const out = []
  for (const edge of [...graph.edges, ...(graph.kinEdges ?? [])]) {
    const from = rank(edge.from)
    const to = rank(edge.to)
    if (from < 0 || to < 0) continue
    if (from < to) out.push(edge)
  }
  return out
}

module.exports = { layerModel, violations, RINGS, OUTSIDE }
