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

/**
 * 파일별 추출 결과 → 그래프.
 *
 * @param files `[{ path, symbols, imports }]`
 * @returns `{ nodes: [{path, symbols, lines}], edges: [{from, to}] }` — 간선은 중복 없이
 */
function buildGraph(files) {
  const known = new Set(files.map((f) => f.path))

  // 이름 → 그 이름을 선언한 파일. Kotlin 수입 해석에 쓴다.
  // **먼저 선언한 파일이 이긴다** — 같은 이름이 여럿이면 어차피 못 가르므로, 임의로
  // 덮어써서 회차마다 다른 그래프가 나오는 것보다 한쪽으로 못 박는 편이 낫다.
  const declaredIn = new Map()
  for (const file of files) {
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'function' && symbol.kind !== 'method' && !declaredIn.has(symbol.name)) {
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

  const nodes = files.map((f) => ({ path: f.path, symbols: f.symbols, lines: f.lines }))
  return { nodes, edges }
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

module.exports = { buildGraph, neighborhood, normalize, resolveRelative, resolvePackage }
