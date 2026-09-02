// 파문을 **그림으로** 그린다. 왼쪽이 고른 파일, 오른쪽으로 갈수록 먼 촌수다.
//
// 목록이 못 하는 일이 하나 있어서 만들었다 — **경로**. 「MatchDetailView 가 3촌」은
// 목록도 말하지만, *누구를 거쳐* 3촌인지는 선을 그어야만 보인다. 고칠 때 실제로 알고 싶은
// 것은 「무엇이 다치나」보다 「무엇을 거쳐 다치나」인 경우가 많다.
//
// > 처음에는 **동심원**이었다 (촌수 = 반지름). 실제 데이터로 그려 보니 엉킨 실타래였다 —
// > 선이 가운데를 가로질러 경로가 안 읽히고, 원 좌우의 이름이 화면 밖으로 잘렸다
// > (`yerGoogleSheetImporter`). 촌수를 **열**로 세우니 셋 다 풀렸다: 선이 한 방향으로만
// > 흐르고, 이름에 가로 자리가 생기고, 열 안에서 세로로만 정렬하면 된다.
//
// **방향을 반드시 그린다.** 화살표가 없으면 `LabeledEnum ─ GameMode` 를 「LabeledEnum 이
// GameMode 를 쓴다」로 읽는데 실제로는 **반대**다. 왼쪽에서 오른쪽으로 읽는 습관 때문에
// 선만 그으면 뜻이 뒤집혀 전달된다. 화살표는 언제나 **쓰는 쪽 → 쓰이는 쪽**이다.
//
// 가운데를 기준으로 **양쪽**을 그린다. 오른쪽은 이 파일을 쓰는 것들(촌수별), 왼쪽은
// 이 파일이 쓰는 것들이다. 한쪽만 그리면 나머지 절반이 목록에만 남아 안 보인다.
//
// 앱의 CSP 가 바깥 스크립트를 막으므로 **손으로 그린 SVG** 다.

const { escapeHtml, shortName, FOCUS } = require('./html')

/** 몇 촌까지 그리나. 그보다 먼 것은 그림에서 빼고 목록에만 남긴다 */
const MAX_COLUMN = 4
const COLUMN_W = 158
const ROW_H = 21
const PAD_Y = 16
/** 이름이 열을 넘으면 자른다 — 넘치면 옆 열의 선 위에 글자가 얹힌다 */
const MAX_CHARS = 21

const LAYER_FILL = {
  domain: '#1f3330',
  application: '#1e2739',
  adapter: '#33261f',
}
const LAYER_LINE = {
  domain: '#4fa892',
  application: '#7b93cc',
  adapter: '#c9885c',
}

/**
 * 열 안에서 세로 자리를 정한다.
 *
 * **안쪽 이웃의 평균 높이로 줄을 세운다.** 그냥 이름순으로 쌓으면 선이 서로를 가로질러
 * 「어디를 거쳐 왔나」가 안 읽힌다. 부모 쪽 높이를 따라가면 같은 뿌리에서 나온 것들이
 * 위아래로 모인다. 부모가 여럿이면 평균이고, 없으면 맨 아래로 보낸다.
 */
function orderColumn(paths, inner, at) {
  const height = (path) => {
    const parents = (inner.get(path) ?? []).map((p) => at.get(p)).filter(Boolean)
    if (parents.length === 0) return Number.POSITIVE_INFINITY
    return parents.reduce((total, p) => total + p.y, 0) / parents.length
  }
  return [...paths].sort((a, b) => height(a) - height(b) || a.localeCompare(b))
}

function place(center, rings, inner, height, uses, left) {
  const columns = [[center], ...rings.slice(0, MAX_COLUMN)]
  const at = new Map()

  columns.forEach((column, index) => {
    const ordered = index === 0 ? column : orderColumn(column, inner, at)
    // 열마다 세로 가운데를 맞춘다 — 위로 몰리면 짧은 열이 긴 열의 머리에 붙어 보인다
    const span = (ordered.length - 1) * ROW_H
    ordered.forEach((path, row) => {
      at.set(path, {
        x: left + index * COLUMN_W,
        y: height / 2 - span / 2 + row * ROW_H,
        column: index,
      })
    })
  })

  // 왼쪽 한 열 — 이 파일이 쓰는 것들. **한 칸만** 그린다: 끝까지 따라가면 라이브러리
  // 경계까지 번져 화면이 남의 이름으로 덮인다 (목록 쪽 `detailHtml` 과 같은 규칙)
  const span = (uses.length - 1) * ROW_H
  uses.forEach((path, row) => {
    at.set(path, { x: left - COLUMN_W, y: height / 2 - span / 2 + row * ROW_H, column: -1 })
  })

  return { at }
}

/** 화살촉. 선 끝에서 조금 물러나 그린다 — 노드 원에 겹치면 뭉개진다 */
function head(a, b, color, opacity) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const tipX = b.x - Math.cos(angle) * 6
  const tipY = b.y - Math.sin(angle) * 6
  const wing = (turn) =>
    `${(tipX - Math.cos(angle + turn) * 6).toFixed(1)},${(tipY - Math.sin(angle + turn) * 6).toFixed(1)}`
  return (
    `<polygon points="${tipX.toFixed(1)},${tipY.toFixed(1)} ${wing(0.42)} ${wing(-0.42)}" ` +
    `fill="${color}" fill-opacity="${opacity}"/>`
  )
}

function dot(path, spot, layer, isCenter) {
  const fill = isCenter ? '#f0b429' : (LAYER_FILL[layer] ?? '#20242c')
  const line = isCenter ? '#ffd76b' : (LAYER_LINE[layer] ?? '#4a5262')
  const name = shortName(path)
  const shown = name.length > MAX_CHARS ? `${name.slice(0, MAX_CHARS - 1)}…` : name
  return (
    `<g class="node" data-command="${FOCUS}" data-arg="${escapeHtml(path)}">` +
    `<title>${escapeHtml(path)}</title>` +
    `<circle cx="${spot.x}" cy="${spot.y.toFixed(1)}" r="${isCenter ? 5.5 : 3.5}" fill="${fill}" ` +
    `stroke="${line}" stroke-width="1.4"/>` +
    `<text x="${spot.x + 9}" y="${(spot.y + 3.5).toFixed(1)}" font-size="${isCenter ? 11.5 : 10}" ` +
    `font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="currentColor" ` +
    `opacity="${isCenter ? 1 : 0.74}"${isCenter ? ' font-weight="600"' : ''}>${escapeHtml(shown)}</text></g>`
  )
}

/**
 * 파문 그림.
 *
 * @param view `{ center, blast, model, violations }`
 * @param edges 수입·상속 간선 전부 `[{from, to}]`
 */
function rippleSvg(view, edges) {
  const rings = view.blast.rings
  const outward = [...new Set(view.outbound ?? [])].filter((path) => path !== view.center)
  // **양쪽이 다 비었을 때만** 안 그린다. 한쪽만 보고 빠져나가면, 아무도 안 쓰지만 남을
  // 쓰는 파일(잎에 가까운 서비스)이 그림을 통째로 잃는다 — langrisser 의
  // `PlayerModifyService` 가 그 모양이라 실측으로 잡혔다
  if (rings.length === 0 && outward.length === 0) return ''

  // 누가 누구를 거쳐 왔나 — **한 칸 안쪽으로 가는** 간선만 남긴다. 같은 열끼리·두 칸을
  // 건너뛰는 선까지 그리면 열의 뜻(촌수)이 흐려진다
  const depth = new Map([[view.center, 0]])
  rings.forEach((ring, i) => {
    for (const path of ring) if (!depth.has(path)) depth.set(path, i + 1)
  })
  const inner = new Map()
  for (const edge of edges) {
    const from = depth.get(edge.from)
    const to = depth.get(edge.to)
    if (from === undefined || to === undefined || to !== from - 1 || from > MAX_COLUMN) continue
    if (!inner.has(edge.from)) inner.set(edge.from, [])
    inner.get(edge.from).push(edge.to)
  }

  // 이 파일이 쓰는 것들 (왼쪽 한 열)
  const uses = [...outward].sort()

  const widest = Math.max(1, uses.length, ...rings.slice(0, MAX_COLUMN).map((ring) => ring.length))
  const height = widest * ROW_H + PAD_Y * 2 + 14
  const left = uses.length > 0 ? COLUMN_W + 18 : 18
  const width = left + Math.min(rings.length, MAX_COLUMN) * COLUMN_W + COLUMN_W
  const { at } = place(view.center, rings, inner, height, uses, left)
  const bad = new Set(view.violations.map((edge) => `${edge.from} ${edge.to}`))

  // **화살표는 쓰는 쪽 → 쓰이는 쪽.** 오른쪽 것들이 가운데를 쓰고, 가운데가 왼쪽 것들을 쓴다
  const pairs = [
    ...[...inner.entries()].flatMap(([from, targets]) => targets.map((to) => [from, to])),
    ...uses.map((path) => [view.center, path]),
  ]

  const lines = pairs
    .map(([from, to]) => {
      const a = at.get(from)
      const b = at.get(to)
      if (!a || !b) return ''
      const warn = bad.has(`${from} ${to}`)
      const color = warn ? '#e0574f' : 'currentColor'
      const opacity = warn ? 0.9 : 0.22
      const mid = (a.x + b.x) / 2
      return (
        `<path d="M${a.x} ${a.y.toFixed(1)} C${mid} ${a.y.toFixed(1)} ${mid} ${b.y.toFixed(1)} ${b.x} ${b.y.toFixed(1)}" ` +
        `fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${warn ? 1.6 : 1}"/>` +
        head(a, b, color, warn ? 0.9 : 0.42)
      )
    })
    .join('')

  const label = (x, text) =>
    `<text x="${x}" y="12" font-size="9.5" letter-spacing="0.08em" ` +
    `font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="currentColor" opacity="0.4">` +
    `${escapeHtml(text)}</text>`

  // **어느 쪽이 무엇인지 글자로도 말한다.** 화살표만으로는 방향을 놓치는 사람이 있고,
  // 열 이름이 「1촌」뿐이면 그 1촌이 쓰는 쪽인지 쓰이는 쪽인지가 그림에 안 적혀 있다
  const heads =
    (uses.length > 0 ? label(left - COLUMN_W, `이 파일이 쓰는 것 ${uses.length}`) : '') +
    [...Array(Math.min(rings.length, MAX_COLUMN))]
      .map((_, i) => label(left + (i + 1) * COLUMN_W, `${i + 1}촌 ${rings[i].length} — 이 파일을 씀`))
      .join('')

  const dots = [...at.entries()]
    .map(([path, spot]) => dot(path, spot, view.model.of.get(path), path === view.center))
    .join('')

  // 4촌보다 먼 것은 그림에서 뺐다는 사실을 **화면이 말한다** — 안 적으면 그림이 전부라고 주장한다
  const cut = rings.length > MAX_COLUMN
    ? `<text x="18" y="${height - 3}" font-size="9.5" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" ` +
      `fill="currentColor" opacity="0.45">${MAX_COLUMN}촌까지 그렸습니다 — 더 먼 ` +
      `${rings.slice(MAX_COLUMN).reduce((n, ring) => n + ring.length, 0)}개는 아래 목록에 있습니다</text>`
    : ''

  return (
    `<svg class="ripple" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMin meet" role="img" ` +
    `aria-label="${escapeHtml(shortName(view.center))} 에서 번지는 범위 — ${view.blast.total}개 파일">` +
    heads +
    lines +
    dots +
    cut +
    `</svg>`
  )
}

module.exports = { rippleSvg, MAX_COLUMN }
