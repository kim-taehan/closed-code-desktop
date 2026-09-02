// 화면. **문구도 배치도 여기서만** 만든다 — main.js 는 배선만 한다.
//
// 앱이 감싸 주는 문서는 CSP 가 조인다: 바깥 스크립트·네트워크가 전부 막히고 인라인만 돈다.
// 그래서 그림도 **손으로** 만든다. 라이브러리를 인라인으로 우겨넣을 수도 있지만, 여기서
// 그리는 것은 네모와 색뿐이라 할 일이 없다.
//
// > 처음에는 **이웃 그래프(SVG)** 였다 — 가운데 파일 하나에 양옆으로 이웃 몇 개.
// > 2026-08-30 에 **단면도**로 바꿨다. 이웃 그래프가 답하는 「누가 나를 쓰나」는 한 걸음만
// > 세는데, 실제로 알고 싶은 것은 **끝까지 번지는 범위**였다. langrisser 실측에서
// > `MetricRank` 는 직접 들어옴이 1개(38위)인데 반경은 10개(10위)다 — 이웃만 그리면
// > 그 파일은 화면에서 영영 한산해 보인다.
//
// 클릭은 앱의 다리 규약 둘로만 나간다 (`extensionHtmlDoc.ts` 의 BRIDGE):
//   data-open="경로" + data-line   — 그 줄로 파일을 연다
//   data-command="id" + data-arg   — 이 확장의 명령을 문자열 하나와 함께 돌린다
// 임의의 값을 보낼 수 없어서, 「다른 파일로 옮겨 보기」는 경로 문자열 하나로 표현한다.

const { READS } = require('./languages')
const { escapeHtml, shortName, breakablePath, FOCUS } = require('./html')
const { rippleSvg } = require('./diagram')

/** 파문을 몇 촌까지 색으로 가를지. 그보다 먼 것은 가장 옅은 색으로 몰아 넣는다 */
const MAX_HOP = 4

const STYLE = `
:root { color-scheme: dark light; }
body { margin: 0; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", sans-serif; }
/* 시안의 짜임 — 머리(위) · 단면도(가운데, **폭 전부**) · 심볼(아래 띠).
   단면도가 이 화면의 주인공이라 옆으로 자리를 내주지 않는다 */
.wrap { display: flex; flex-direction: column; height: 100vh; }
.phead { flex: none; padding: 12px 16px 10px; border-bottom: 1px solid rgba(139,148,158,0.16); }
.canvas { flex: 1; min-width: 0; overflow: auto; padding: 12px 16px; }
.syms { flex: none; border-top: 1px solid rgba(139,148,158,0.16); padding: 8px 16px 10px; max-height: 30vh; overflow: auto; }
h2 { margin: 0; font: 600 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.sub { margin: 2px 0 0; font-size: 11px; opacity: 0.62; font-variant-numeric: tabular-nums; }
.label { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.55; margin: 0 0 6px; }
/* 심볼은 **가로로 흐르는 칩**이다 — 세로 목록으로 세우면 단면도의 폭을 먹는다 */
.slist { display: flex; flex-wrap: wrap; gap: 4px; }
.sym { padding: 2px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap;
       font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
       display: inline-flex; gap: 6px; align-items: baseline;
       background: rgba(128,128,128,0.09); border: 1px solid rgba(139,148,158,0.2); }
.sym:hover { background: rgba(139,148,158,0.2); }
.kind { font-size: 9px; font-weight: 700; padding: 0 4px; border-radius: 3px; opacity: 0.9; }
.k-class, .k-interface, .k-object, .k-record { background: rgba(210,168,255,0.18); color: #d2a8ff; }
.k-function, .k-method { background: rgba(255,123,114,0.16); color: #ff7b72; }
.k-constructor { background: rgba(240,180,41,0.18); color: #f0b429; }
.params { opacity: 0.42; font-size: 10.5px; }
.ln { opacity: 0.5; font-variant-numeric: tabular-nums; }
.empty { padding: 28px; opacity: 0.7; }
.more { font-size: 10.5px; opacity: 0.6; padding: 2px 6px; }

/* 반경과 촌수는 **한 줄에** 둔다 — 촌수는 그 숫자의 내역이라 떨어뜨리면 관계가 안 보인다 */
.brow { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; margin-top: 9px; }
.blast { font: 600 26px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: #f0b429;
         font-variant-numeric: tabular-nums; }
.hops { display: flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }
.hop { font: 10.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 1px 7px;
       border-radius: 20px; border: 1px solid rgba(240,180,41,0.35); opacity: 0.85; }
.foot { display: flex; gap: 14px; flex-wrap: wrap; align-items: baseline; margin-top: 8px; }

/* 상세 — **숫자마다 목록을 단다.** 「1촌 8」 이 여덟이 누구인지 말하지 않으면 그 숫자는
   막다른 길이고, 화면은 재 놓고 들어갈 문을 안 낸 것이 된다 */
.detail { margin-top: 18px; border-top: 1px solid rgba(139,148,158,0.16); padding-top: 12px; }
.dsec { margin-bottom: 13px; }
.dhead { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.55;
         margin-bottom: 6px; }
.dhead .warn { opacity: 1; }
.drow { display: flex; gap: 8px; align-items: baseline; margin-bottom: 5px; }
.dtag { flex: none; width: 58px; font: 10.5px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace;
        opacity: 0.6; font-variant-numeric: tabular-nums; }
.refs { display: flex; flex-wrap: wrap; gap: 3px; min-width: 0; }
.ref { font: 10.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 1px 6px;
       border-radius: 4px; cursor: pointer; white-space: nowrap;
       background: rgba(128,128,128,0.09); border: 1px solid rgba(139,148,158,0.2); }
.ref:hover { background: rgba(139,148,158,0.22); }
.ref.bad { border-color: rgba(224,87,79,0.6); color: #e0574f; }
.arrow { opacity: 0.4; font-size: 10.5px; }
.none { font-size: 11px; opacity: 0.45; }

.axis { font-size: 10px; opacity: 0.42; margin: 0 0 8px; }
/* 파문 그림. 노드를 누르면 그 파일로 옮겨 간다 */
.ripple { display: block; max-width: 720px; margin: 0 auto 14px; }
.ripple .node { cursor: pointer; }
.ripple .node:hover text { opacity: 1; }
.ripple .node:hover circle { stroke-width: 2.4; }
.band { border-left: 2px solid rgba(139,148,158,0.4); padding-left: 10px; margin: 0 0 11px; }
.band-domain { border-left-color: #4fa892; }
.band-application { border-left-color: #7b93cc; }
.band-adapter { border-left-color: #c9885c; }
.bhead { display: flex; align-items: baseline; gap: 7px; margin-bottom: 5px;
         font: 10.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
         letter-spacing: 0.09em; text-transform: uppercase; opacity: 0.72; }
.bn { font-size: 10px; opacity: 0.6; font-variant-numeric: tabular-nums; }
.cells { display: flex; flex-wrap: wrap; gap: 4px; }
.cell { font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 2px 7px;
        border-radius: 4px; cursor: pointer; white-space: nowrap;
        background: rgba(128,128,128,0.09); border: 1px solid rgba(139,148,158,0.22); opacity: 0.55; }
.cell:hover { opacity: 1; }
.h1 { background: rgba(240,180,41,0.30); border-color: rgba(240,180,41,0.75); opacity: 1; }
.h2 { background: rgba(240,180,41,0.19); border-color: rgba(240,180,41,0.5); opacity: 1; }
.h3 { background: rgba(240,180,41,0.12); border-color: rgba(240,180,41,0.34); opacity: 0.92; }
.h4 { background: rgba(240,180,41,0.07); border-color: rgba(240,180,41,0.22); opacity: 0.85; }
.sel { background: #f0b429; border-color: #f0b429; color: #17120a; font-weight: 700; opacity: 1; }
.vt { border-color: #e0574f; color: #e0574f; background: rgba(224,87,79,0.14); opacity: 1; }
.warn { color: #e0574f; }
`

/**
 * 단면도. 층을 **바깥부터 아래로** 쌓고, 고른 파일에서 번지는 범위를 색으로 물들인다.
 *
 * 층 순서가 곧 주장이다 — 아래로 갈수록 안쪽이고, 의존은 아래로만 흘러야 한다.
 * 그 주장이 성립하지 않는 프로젝트(폴더 모드)에서는 `model.note` 가 그렇게 말한다.
 *
 * @param nodes `graph.nodes`
 * @param model `layerModel` 결과
 * @param focus 지금 보고 있는 경로
 * @param hops 경로 → 촌수 (Map). 고른 파일 자신은 들어 있지 않다
 * @param targets 이 파일이 **층을 어기며** 가리키는 경로들 (Set)
 * @param blasts 경로 → 반경 (Map). **셀 자리를 고정하는 데만** 쓴다 (아래 사유 참조)
 */
function strataHtml(nodes, model, focus, hops, targets, blasts = new Map()) {
  const byLayer = new Map(model.order.map((id) => [id, []]))
  for (const node of nodes) {
    const layer = model.of.get(node.path)
    if (byLayer.has(layer)) byLayer.get(layer).push(node)
  }

  const bands = model.order
    .map((id) => {
      const group = byLayer.get(id) ?? []
      if (group.length === 0) return ''
      // **반경이 큰 것부터. 무엇을 골랐든 이 순서는 안 바뀐다.**
      //
      // 한 번 촌수 순으로 정렬했다가 되돌렸다 — 고를 때마다 셀이 자리를 바꾸면 파문이
      // 「번지는」 것으로 안 보이고 화면이 통째로 갈아엎히는 것으로 보인다. 자리가 고정돼야
      // 색만 움직이고, 그래야 어디까지 물들었는지가 읽힌다.
      const cells = [...group]
        .sort((a, b) => (blasts.get(b.path) ?? 0) - (blasts.get(a.path) ?? 0) || a.path.localeCompare(b.path))
        .map((node) => {
          const hop = hops.get(node.path)
          const tone = node.path === focus ? 'sel' : hop ? `h${Math.min(hop, MAX_HOP)}` : ''
          const bad = targets.has(node.path) ? ' vt' : ''
          const title = `${node.path}${hop ? ` · ${hop}촌` : ''}`
          return (
            `<span class="cell ${tone}${bad}" data-command="${FOCUS}" data-arg="${escapeHtml(node.path)}" ` +
            `title="${escapeHtml(title)}">${escapeHtml(shortName(node.path))}</span>`
          )
        })
        .join('')
      return (
        `<div class="band band-${escapeHtml(id)}">` +
        `<div class="bhead"><span>${escapeHtml(id)}</span><span class="bn">${group.length}</span></div>` +
        `<div class="cells">${cells}</div></div>`
      )
    })
    .join('')

  return `<p class="axis">${escapeHtml(model.note)}</p>${bands}`
}

/** 파일 하나를 가리키는 누를 수 있는 이름표 */
function ref(path, bad) {
  return (
    `<span class="ref${bad ? ' bad' : ''}" data-command="${FOCUS}" data-arg="${escapeHtml(path)}" ` +
    `title="${escapeHtml(path)}">${escapeHtml(shortName(path))}</span>`
  )
}

/**
 * **상세 — 화면의 모든 숫자에 목록을 단다.**
 *
 * 단면도는 「어디까지 번지나」를 색으로 보여주지만, 41개가 물든 화면에서 *누가* 1촌이고
 * 누가 4촌인지는 색만으로 못 읽는다. 촌수 칩(`1촌 8`)과 「층 위반 2건」이 숫자만 말하고
 * 끝나면 **재 놓고 들어갈 문을 안 낸 것**이다 — 사용자가 「상세는 어떻게 보나」를 묻게 된다.
 *
 * 여기 있는 이름은 전부 누를 수 있고, 누르면 그 파일로 옮겨 간다.
 */
function detailHtml(view) {
  const hop = view.blast.rings
    .map(
      (ring, i) =>
        `<div class="drow"><span class="dtag">${i + 1}촌 ${ring.length}</span>` +
        `<span class="refs">${ring.map((p) => ref(p, false)).join('')}</span></div>`,
    )
    .join('')

  // 나가는 쪽은 촌수가 없다 — 「내가 무엇을 쓰나」는 한 걸음이면 충분하고, 끝까지 따라가면
  // 라이브러리 경계까지 번져 화면이 남의 이름으로 덮인다
  const out =
    view.outbound.length > 0
      ? `<div class="drow"><span class="dtag">${view.outbound.length}개</span>` +
        `<span class="refs">${[...new Set(view.outbound)].map((p) => ref(p, false)).join('')}</span></div>`
      : '<p class="none">이 파일은 프로젝트 안의 다른 파일을 쓰지 않습니다.</p>'

  // 위반은 **양끝을 다 보여준다.** 어긴 쪽만 적으면 무엇을 향해 어겼는지가 빠진다
  const bad =
    view.model.mode !== 'hexagonal' || view.violations.length === 0
      ? ''
      : `<div class="dsec"><div class="dhead"><span class="warn">층 위반 ${view.violations.length}건</span>` +
        ` — 안쪽이 바깥을 씁니다</div>` +
        view.violations
          .map(
            (edge) =>
              `<div class="drow"><span class="dtag"></span><span class="refs">` +
              `${ref(edge.from, true)}<span class="arrow">→</span>${ref(edge.to, true)}</span></div>`,
          )
          .join('') +
        `</div>`

  return (
    `<div class="detail">` +
    `<div class="dsec"><div class="dhead">이 파일을 고치면 닿는 것 ${view.blast.total}</div>` +
    (hop || '<p class="none">아무도 이 파일을 쓰지 않습니다.</p>') +
    `</div>` +
    `<div class="dsec"><div class="dhead">이 파일이 쓰는 것</div>${out}</div>` +
    bad +
    `</div>`
  )
}

function symbolList(path, symbols) {
  if (symbols.length === 0) return '<p class="more">심볼이 없습니다.</p>'
  return (
    '<div class="slist">' +
    symbols
      .map(
        (s) =>
          `<span class="sym" data-open="${escapeHtml(path)}" data-line="${s.line}">` +
          `<span class="kind k-${s.kind}">${s.kind.slice(0, 3)}</span>` +
          `${escapeHtml(s.name)}${s.params ? `<span class="params">${escapeHtml(s.params)}</span>` : ''}` +
          `<span class="ln">${s.line}</span></span>`,
      )
      .join('') +
    '</div>'
  )
}

/** 아직 지도가 없을 때. **규모와 걸릴 시간을 먼저 말한다** */
function emptyHtml(message) {
  return `<style>${STYLE}</style><div class="empty">${escapeHtml(message)}</div>`
}

/**
 * 결과 화면.
 *
 * @param graph `buildGraph` 결과
 * @param view `{ center, inbound, outbound, blast, blasts, model, violations }`
 * @param stats `{ files, symbols, edges, seconds, failed }`
 */
function boardHtml(graph, view, stats) {
  const node = graph.nodes.find((n) => n.path === view.center)
  const symbols = node ? node.symbols : []

  const hops = new Map()
  view.blast.rings.forEach((ring, i) => {
    for (const path of ring) if (!hops.has(path)) hops.set(path, i + 1)
  })
  const targets = new Set(view.violations.filter((e) => e.from === view.center).map((e) => e.to))

  const percent = stats.files > 0 ? Math.round((view.blast.total / stats.files) * 100) : 0
  const hopChips = view.blast.rings
    .map((ring, i) => `<span class="hop">${i + 1}촌 ${ring.length}</span>`)
    .join('')

  const failed = stats.failed > 0
    ? `<p class="more">읽지 못한 파일 ${stats.failed}개 — 우리가 모르는 문법일 수 있습니다.</p>`
    : ''
  // 위반은 **0일 때도 적는다.** 안 적으면 「재지 않았다」와 구분되지 않는다
  const violated = view.model.mode === 'hexagonal'
    ? `<p class="more${view.violations.length > 0 ? ' warn' : ''}">층 위반 ${view.violations.length}건</p>`
    : ''

  return (
    `<style>${STYLE}</style>` +
    `<div class="wrap">` +
    `<div class="phead">` +
    `<h2>${breakablePath(view.center)}</h2>` +
    `<p class="sub">${node ? node.lines : 0}줄 · 들어옴 ${view.inbound.length} · 나감 ${view.outbound.length}` +
    ` · ${escapeHtml(view.model.of.get(view.center) ?? '')}</p>` +
    `<div class="brow"><span class="blast">${view.blast.total}</span>` +
    // **닿는 것과 깨지는 것은 다르다.** 파일 단위 간선에서 나온 값이라 이 구분을 흐리면
    // 숫자를 못 믿게 된다 (`blastRadius` 머리말)
    `<span class="sub">/ ${stats.files}개 파일에 닿습니다 · ${percent}%</span>` +
    `<span class="hops">${hopChips || '<span class="hop">아무도 쓰지 않습니다</span>'}</span>` +
    `</div></div>` +
    // 그림이 먼저다 — **번지는 경로**는 선을 그어야만 보인다. 그 아래에 전체 단면도와
    // 목록을 둔다 (그림은 닿는 것만 그리고, 단면도는 프로젝트 전부를 보여준다)
    `<div class="canvas">${rippleSvg(view, [...graph.edges, ...(graph.kinEdges ?? [])])}` +
    `${strataHtml(graph.nodes, view.model, view.center, hops, targets, view.blasts)}` +
    `${detailHtml(view)}</div>` +
    `<div class="syms">` +
    `<div class="label">심볼 ${symbols.length}</div>` +
    symbolList(view.center, symbols) +
    `<div class="foot">` +
    // **무엇을 읽었는지 항상 적는다.** 안 적으면 Java 프로젝트에서 「파일 1개」가 나올 때
    // 지도가 깨진 것으로 읽힌다 — 실제로는 읽을 수 있는 파일이 그것뿐이었다 (실측 사례)
    `<span class="sub">파일 ${stats.files} · 심볼 ${stats.symbols} · 간선 ${stats.edges} · ` +
    `${stats.seconds}초에 읽음 · ${READS}</span>` +
    violated +
    failed +
    `</div></div></div>`
  )
}

module.exports = { boardHtml, emptyHtml, strataHtml, detailHtml, symbolList, escapeHtml, breakablePath, shortName, FOCUS, MAX_HOP }
