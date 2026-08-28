// 화면. **문구도 배치도 여기서만** 만든다 — main.js 는 배선만 한다.
//
// 앱이 감싸 주는 문서는 CSP 가 조인다: 바깥 스크립트·네트워크가 전부 막히고 인라인만 돈다.
// 그래서 그래프는 **손으로 그린 SVG** 다. 라이브러리를 인라인으로 우겨넣을 수도 있지만,
// 이웃 하나를 그리는 데 필요한 것은 원과 선뿐이다.
//
// 클릭은 앱의 다리 규약 둘로만 나간다 (`extensionHtmlDoc.ts` 의 BRIDGE):
//   data-open="경로" + data-line   — 그 줄로 파일을 연다
//   data-command="id" + data-arg   — 이 확장의 명령을 문자열 하나와 함께 돌린다
// 임의의 값을 보낼 수 없어서, 「다른 파일로 옮겨 보기」는 경로 문자열 하나로 표현한다.

const FOCUS = 'codeMap.focus'

/** 이웃을 한쪽에 몇 개까지 그릴지. 넘치면 **몇 개를 뺐는지 화면에 적는다** */
const MAX_SIDE = 6

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function baseName(path) {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * 긴 경로를 **디렉토리 경계에서** 접히게 한다.
 *
 * 그냥 두면 낱말 한가운데서 끊겨 `develop/ x/llm/…` 처럼 보인다 — 경로를 눈으로 따라가는
 * 것이 이 줄의 유일한 쓸모인데 그게 안 된다. `<wbr>` 은 **접어도 되는 자리**만 알려 주고
 * 글자를 더하지 않는다.
 */
function breakablePath(path) {
  return escapeHtml(path).split('/').join('/<wbr>')
}

const STYLE = `
:root { color-scheme: dark light; }
body { margin: 0; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", sans-serif; }
.wrap { display: flex; height: 100vh; }
.canvas { flex: 1; min-width: 0; overflow: auto; }
.side { width: 260px; flex: none; border-left: 1px solid rgba(139,148,158,0.2); padding: 14px; overflow: auto; }
h2 { margin: 0 0 2px; font: 600 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.sub { margin: 0 0 14px; font-size: 11px; opacity: 0.62; font-variant-numeric: tabular-nums; }
.label { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.55; margin: 14px 0 5px; }
.sym { display: block; padding: 3px 6px; border-radius: 5px; cursor: pointer;
       font: 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; display: flex; gap: 7px; align-items: center; }
.sym:hover { background: rgba(139,148,158,0.14); }
.kind { font-size: 9px; font-weight: 700; padding: 0 4px; border-radius: 3px; opacity: 0.9; }
.k-class, .k-interface, .k-object { background: rgba(210,168,255,0.18); color: #d2a8ff; }
.k-function, .k-method { background: rgba(255,123,114,0.16); color: #ff7b72; }
.ln { margin-left: auto; opacity: 0.5; font-variant-numeric: tabular-nums; }
.node { cursor: pointer; }
.node:hover rect { stroke-opacity: 1; }
.empty { padding: 28px; opacity: 0.7; }
.more { font-size: 10.5px; opacity: 0.6; padding: 2px 6px; }
`

/** 노드 상자 하나. 가운데 것은 강조하고 나머지는 눌러서 옮겨 갈 수 있게 한다 */
function nodeBox(path, x, y, width, center) {
  const fill = center ? 'rgba(121,192,255,0.14)' : 'rgba(128,128,128,0.09)'
  const stroke = center ? '#79c0ff' : 'rgba(139,148,158,0.45)'
  const attrs = center ? '' : ` class="node" data-command="${FOCUS}" data-arg="${escapeHtml(path)}"`
  return `<g${attrs}><title>${escapeHtml(path)}</title>` +
    `<rect x="${x}" y="${y}" width="${width}" height="30" rx="8" fill="${fill}" stroke="${stroke}" stroke-opacity="0.75"/>` +
    `<text x="${x + width / 2}" y="${y + 19}" text-anchor="middle" font-size="11" ` +
    `font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="currentColor"` +
    `${center ? ' font-weight="600"' : ' opacity="0.72"'}>${escapeHtml(baseName(path))}</text></g>`
}

/**
 * 이웃 그래프. 들어오는 것은 왼쪽, 나가는 것은 오른쪽.
 *
 * 자동 배치를 두지 않았다 — 한 번에 그리는 것이 **가운데 하나와 양옆 몇 개**뿐이라
 * 레이아웃 알고리즘이 할 일이 없다. 전체 그래프를 그리게 되면 그때 필요해진다.
 */
function graphSvg(view) {
  const { center, inbound, outbound } = view
  const left = inbound.slice(0, MAX_SIDE)
  const right = outbound.slice(0, MAX_SIDE)
  const rows = Math.max(left.length, right.length, 1)
  const height = Math.max(rows * 46 + 40, 200)
  const midY = height / 2 - 15
  const W = 720
  const boxW = 150

  const place = (list, x) =>
    list.map((path, i) => {
      const y = height / 2 - (list.length * 46) / 2 + i * 46
      return { path, x, y }
    })

  const lefts = place(left, 20)
  const rights = place(right, W - boxW - 20)
  const cx = W / 2 - boxW / 2

  const edges = [
    ...lefts.map((n) => `<path d="M${n.x + boxW} ${n.y + 15} L${cx} ${midY + 15}" />`),
    ...rights.map((n) => `<path d="M${cx + boxW} ${midY + 15} L${n.x} ${n.y + 15}" />`),
  ].join('')

  const boxes = [
    ...lefts.map((n) => nodeBox(n.path, n.x, n.y, boxW, false)),
    ...rights.map((n) => nodeBox(n.path, n.x, n.y, boxW, false)),
    nodeBox(center, cx, midY, boxW, true),
  ].join('')

  // **자른 것을 숨기지 않는다.** 「6개만 보인다」를 안 적으면 화면이 전부라고 주장하게 된다
  const cut = (list, x, y) =>
    list.length > MAX_SIDE
      ? `<text x="${x}" y="${y}" font-size="10" fill="currentColor" opacity="0.55">+${list.length - MAX_SIDE}개 더</text>`
      : ''

  return `<svg viewBox="0 0 ${W} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" ` +
    `aria-label="${escapeHtml(baseName(center))} 의 이웃 — 들어옴 ${inbound.length}, 나감 ${outbound.length}">` +
    `<g fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="1.2">${edges}</g>` +
    boxes +
    cut(inbound, 20, height - 12) +
    cut(outbound, W - 90, height - 12) +
    `</svg>`
}

function symbolList(path, symbols) {
  if (symbols.length === 0) return '<p class="more">심볼이 없습니다.</p>'
  return symbols
    .map(
      (s) =>
        `<span class="sym" data-open="${escapeHtml(path)}" data-line="${s.line}">` +
        `<span class="kind k-${s.kind}">${s.kind.slice(0, 3)}</span>` +
        `${escapeHtml(s.name)}<span class="ln">${s.line}</span></span>`,
    )
    .join('')
}

/** 아직 지도가 없을 때. **규모와 걸릴 시간을 먼저 말한다** */
function emptyHtml(message) {
  return `<style>${STYLE}</style><div class="empty">${escapeHtml(message)}</div>`
}

/**
 * 결과 화면.
 *
 * @param graph `buildGraph` 결과
 * @param view `neighborhood` 결과
 * @param stats `{ files, symbols, edges, seconds, failed }`
 */
function boardHtml(graph, view, stats) {
  const node = graph.nodes.find((n) => n.path === view.center)
  const symbols = node ? node.symbols : []
  const failed = stats.failed > 0
    ? `<p class="more">읽지 못한 파일 ${stats.failed}개 — 문법이 모르는 문법일 수 있습니다.</p>`
    : ''

  return (
    `<style>${STYLE}</style>` +
    `<div class="wrap">` +
    `<div class="canvas">${graphSvg(view)}</div>` +
    `<div class="side">` +
    `<h2>${breakablePath(view.center)}</h2>` +
    `<p class="sub">${node ? node.lines : 0}줄 · 들어옴 ${view.inbound.length} · 나감 ${view.outbound.length}</p>` +
    `<div class="label">심볼 ${symbols.length}</div>` +
    symbolList(view.center, symbols) +
    `<div class="label">지도</div>` +
    `<p class="sub">파일 ${stats.files} · 심볼 ${stats.symbols} · 간선 ${stats.edges}<br>${stats.seconds}초에 읽음</p>` +
    failed +
    `</div></div>`
  )
}

module.exports = { boardHtml, emptyHtml, graphSvg, symbolList, escapeHtml, breakablePath, FOCUS, MAX_SIDE }
