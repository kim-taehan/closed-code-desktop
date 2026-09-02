// 파일들의 구조를 **파일 사이의 그래프**로 접는다.
//
// 간선을 **파일 단위**로 둔 것은 의도다. tree-sitter 가 주는 호출 정보에는 파일 경로가 없어
// 동명 함수를 못 가른다 — 이 워크스페이스에도 `SlidingWindowRateLimiter` 안에 `admit` 이
// 둘 있다(포트 구현 하나, 내부 창 하나). 함수 단위 간선을 그리려면 심볼 해석 층이 따로
// 필요하고, 그 층 없이 그리면 **틀린 선을 자신 있게** 보여주게 된다.

/** `a/b/c.ts` → `a/b` */
function dirOf(path) {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? '' : path.slice(0, cut)
}

/** `a/b/../c` → `a/c`. 프로젝트 상대 경로만 다루므로 `path.resolve` 를 쓰지 않는다 */
function normalize(path) {
  const out = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

const SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

/**
 * TypeScript 의 상대 수입을 파일로 바꾼다.
 *
 * 소스는 확장자를 안 적는 것이 보통이라(`./translate`) 후보를 순서대로 대 본다.
 * **패키지 수입(`react`·`node:fs`)은 null 이다** — 프로젝트 밖은 그래프에 안 그린다.
 */
function resolveRelative(fromPath, source, known) {
  if (!source.startsWith('.')) return null
  const base = normalize(`${dirOf(fromPath)}/${source}`)
  for (const suffix of SUFFIXES) {
    const candidate = `${base}${suffix}`
    if (known.has(candidate)) return candidate
  }
  return null
}

/**
 * Kotlin·Java 의 수입을 파일로 바꾼다.
 *
 * 둘 다 파일 경로가 아니라 **패키지 경로**(`develop.x.gateway.domain.RateLimit`)라
 * 상대 경로 해석이 통하지 않는다. 대신 마지막 마디를 **그 이름을 선언한 파일**에서 찾는다 —
 * 한 프로젝트 안에서는 이것으로 충분하고, 못 찾으면 그리지 않는다(프로젝트 밖 수입이다).
 *
 * `import a.b.*` 는 무엇을 쓰는지 알 수 없어 **버린다.** 짐작해서 선을 그으면 틀린 선이 된다.
 */
function resolvePackage(source, declaredIn) {
  const last = source.split('.').pop()
  if (!last || last === '*') return null
  return declaredIn.get(last) ?? null
}

/** 타입이 아니라 **값**을 선언하는 것들. 이름으로 파일을 찾는 표에 넣지 않는다 */
const VALUE_KINDS = new Set(['function', 'method', 'constructor'])

/**
 * 파일별 추출 결과 → 그래프.
 *
 * @param files `[{ path, symbols, imports, kin }]`
 * @returns `{ nodes: [{path, symbols, lines}], edges, kinEdges }` — 둘 다 `[{from, to}]` 이고
 *          각각 중복이 없다. `edges` 는 수입, `kinEdges` 는 상속·구현이다 (아래 사유 참조)
 */
function buildGraph(files) {
  const known = new Set(files.map((f) => f.path))

  // 이름 → 그 이름을 선언한 파일. Kotlin 수입 해석에 쓴다.
  // **먼저 선언한 파일이 이긴다** — 같은 이름이 여럿이면 어차피 못 가르므로, 임의로
  // 덮어써서 회차마다 다른 그래프가 나오는 것보다 한쪽으로 못 박는 편이 낫다.
  const declaredIn = new Map()
  for (const file of files) {
    for (const symbol of file.symbols) {
      // 함수·메서드·**생성자**는 타입이 아니다. 생성자 이름은 클래스와 같아서 넣어도 값이
      // 같지만, 「타입을 선언한 자리」라는 이 표의 뜻이 흐려진다
      if (!VALUE_KINDS.has(symbol.kind) && !declaredIn.has(symbol.name)) {
        declaredIn.set(symbol.name, file.path)
      }
    }
  }

  const seen = new Set()
  const edges = []
  for (const file of files) {
    for (const one of file.imports) {
      const to = one.source.startsWith('.')
        ? resolveRelative(file.path, one.source, known)
        : resolvePackage(one.source, declaredIn)
      if (!to || to === file.path) continue
      const key = `${file.path}\0${to}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from: file.path, to })
    }
  }

  // 상속·구현은 **수입과 다른 선**이다. 같은 배열에 섞으면 화면이 둘을 구분할 수 없고,
  // 「이 포트의 구현체가 어디 있나」가 다시 안 보이게 된다. 그래서 갈라 둔다.
  //
  // 대부분 수입 간선과 겹친다(구현하려면 대개 수입해야 한다). 겹치는 것을 지우지 않는다 —
  // 같은 두 파일이 **두 가지 이유로** 이어져 있다는 것이 사실이고, 화면은 그것을 말해야 한다.
  const kinSeen = new Set()
  const kinEdges = []
  for (const file of files) {
    for (const name of file.kin ?? []) {
      const to = declaredIn.get(name)
      if (!to || to === file.path) continue
      const key = `${file.path}\0${to}`
      if (kinSeen.has(key)) continue
      kinSeen.add(key)
      kinEdges.push({ from: file.path, to })
    }
  }

  const nodes = files.map((f) => ({ path: f.path, symbols: f.symbols, lines: f.lines }))
  return { nodes, edges, kinEdges }
}

/**
 * **이 파일을 고치면 어디까지 번지나.**
 *
 * 들어오는 방향으로 끝까지 따라가며 촌수별로 묶는다. 「직접 참조 수」와 다른 값이고,
 * 순위가 실제로 뒤집힌다 — langrisser 실측에서 `MetricRank` 는 직접 들어옴이 **1개(38위)**
 * 인데 반경은 10개(10위)다. `Player` 를 거쳐 번지기 때문이고, 정렬로는 나오지 않는다.
 *
 * **수입과 상속을 함께 센다.** 인터페이스를 고치면 구현체가 깨지는데, 같은 패키지에 있으면
 * 수입 문장이 아예 없어서 수입 간선만으로는 그 관계가 안 보인다.
 *
 * ⚠️ 이 값은 **닿는 범위**이지 깨지는 범위가 아니다. 파일 단위 간선에서 나온 값이라
 * 「이 41개가 전부 고장난다」는 뜻이 될 수 없다 — 화면이 그 구분을 흐리면 숫자를 못 믿게 된다.
 *
 * @returns `{ rings: [[path...]], total }` — rings[0] 이 1촌. 촌수 안에서는 경로순으로 고정한다
 */
function blastRadius(graph, path) {
  const reverse = new Map()
  for (const edge of [...graph.edges, ...(graph.kinEdges ?? [])]) {
    if (!reverse.has(edge.to)) reverse.set(edge.to, [])
    reverse.get(edge.to).push(edge.from)
  }

  const seen = new Set([path])
  const rings = []
  let frontier = [path]
  while (frontier.length > 0) {
    const next = []
    for (const one of frontier) {
      for (const from of reverse.get(one) ?? []) {
        if (seen.has(from)) continue
        seen.add(from)
        next.push(from)
      }
    }
    if (next.length === 0) break
    // 훑는 순서가 화면을 정하지 않게 못 박는다 — 같은 코드면 같은 그림이어야 한다
    rings.push(next.sort())
    frontier = next
  }
  return { rings, total: seen.size - 1 }
}

/**
 * 한 파일의 **이웃만** 고른다. 1,002개를 한 화면에 뿌리면 아무것도 안 읽힌다 —
 * 시안이 정한 규칙이 이것이고, 여기가 그 규칙이 사는 자리다.
 */
function neighborhood(graph, path) {
  const inbound = graph.edges.filter((e) => e.to === path).map((e) => e.from)
  const outbound = graph.edges.filter((e) => e.from === path).map((e) => e.to)
  return { center: path, inbound, outbound }
}

module.exports = { buildGraph, neighborhood, blastRadius, normalize, resolveRelative, resolvePackage }
