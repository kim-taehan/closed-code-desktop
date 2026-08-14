// 본문 탭 한 장을 그린다 — 왼쪽 화면 목록, 오른쪽 그 화면의 시나리오 (설계 §2, 3안).
//
// **두 칸이 한 문서다.** 호스트는 화면 하나에 HTML 하나를 받으므로(`view.setHtml`)
// 목록과 상세를 따로 밀 수 없다. 고르는 일은 이 문서 안의 스크립트가 한다 —
// 확장을 왕복하면 한 번 누를 때마다 IPC 를 타고 화면이 통째로 다시 그려진다.
// (시나리오 표를 그리는 부분은 5단계에서 `detail.js` 로 갈린다.)
//
// **색을 직접 쓰지 않는다.** 호스트가 지금 테마의 값을 문서에 심어 주는데
// (`src/state/extensionHtmlDoc.ts` 의 `baseStyle`) 그것을 CSS 변수로 내주지는 않는다.
// 그래서 선·바탕은 `currentColor` 를 섞어 만든다 — 어둠/밝음 둘 다에서 맞는다.
// 흐린 글씨는 호스트가 주는 `.muted` 를 쓴다.

const { NONE, DRAFT, FIXED } = require('../store')

const PILL = {
  [NONE]: '없음',
  [DRAFT]: '초안',
  [FIXED]: '확정',
}

function boardHtml(screens, selectedId) {
  const selected = screens.find((one) => one.id === selectedId) || screens[0] || null

  return `
<div class="sc">
  <div class="sc-side">
    <div class="sc-actions">
      <button type="button" data-command="screenScenario.find">화면 찾기</button>
      <button type="button" data-command="screenScenario.add">화면 더하기</button>
      <button type="button" data-command="screenScenario.writeMissing">없는 것 만들기</button>
    </div>
    <div class="sc-rows">${screens.map((one) => rowHtml(one, selected)).join('')}</div>
  </div>
  <div class="sc-main">${mainHtml(screens, selected)}</div>
</div>
${STYLE}
${SCRIPT}`
}

/**
 * 오른쪽 칸. **화면마다 상세를 다 그려 두고 하나만 보인다.**
 *
 * 고를 때마다 확장을 부르면 IPC 왕복 + 화면 통째 재생성이 붙는다. 화면 수십 개 · 케이스
 * 수백 개는 한 문서에 넉넉히 들어간다 (저장소 상한이 8MB 다).
 */
function mainHtml(screens, selected) {
  if (screens.length === 0) return detailHtml(null)
  return screens
    .map(
      (one) =>
        `<section class="sc-detail" data-for="${esc(one.id)}"${one === selected ? '' : ' hidden'}>${detailHtml(one)}</section>`,
    )
    .join('')
}

function rowHtml(screen, selected) {
  const on = selected !== null && selected.id === screen.id
  return `<div class="sc-row${on ? ' on' : ''}" data-pick="${esc(screen.id)}">
  <span class="sc-name">
    <span>${esc(screen.name)}</span>
    <span class="muted sc-path">${esc(screen.id)}</span>
  </span>
  <span class="sc-pill sc-${esc(screen.state)}">${PILL[screen.state] || PILL[NONE]}</span>
</div>`
}

function detailHtml(screen) {
  if (screen === null) {
    return `<p class="muted sc-empty">아직 화면이 없습니다. <b>화면 찾기</b>로 훑거나 <b>화면 더하기</b>로 직접 넣으세요.</p>`
  }

  // 열기 규약은 호스트의 `data-open` 이다 — 경로를 누르면 그 파일이 편집기 탭으로 열린다
  const head = `<h2 class="sc-title">${esc(screen.name)}</h2>
<p class="sc-meta"><a data-open="${esc(screen.id)}">${esc(screen.id)}</a> · 케이스 ${screen.cases.length}</p>`

  if (screen.cases.length === 0) {
    return `${head}
<p class="muted sc-empty">시나리오가 아직 없습니다.</p>
${actions(screen)}`
  }

  return `${head}
<table>
  <tr><th></th><th>조작</th><th>입력</th><th>기대 결과</th></tr>
  ${screen.cases.map(caseRow).join('')}
</table>
${actions(screen)}`
}

/**
 * 그 화면에 거는 명령들. **대상은 `data-arg` 로 함께 간다** — 화면 안에서 고른 것은
 * 문서에 머물러 확장이 모르기 때문이다 (`extensionHtmlDoc.ts` 의 `data-arg`).
 *
 * 「다시 만들기」는 **확정을 초안으로 내린다**는 것을 눌리기 전에 말한다 (설계 §3.4).
 */
function actions(screen) {
  const write = screen.cases.length === 0 ? '시나리오 만들기' : '다시 만들기'
  const warn = screen.state === FIXED ? ' title="다시 만들면 확정이 초안으로 내려갑니다"' : ''
  const state =
    screen.state === FIXED
      ? `<button type="button" data-command="screenScenario.unfix" data-arg="${esc(screen.id)}">초안으로</button>`
      : screen.cases.length === 0
        ? ''
        : `<button type="button" data-command="screenScenario.fix" data-arg="${esc(screen.id)}">확정으로</button>`

  return `<div class="sc-actions sc-actions--main">
  <button type="button" data-command="screenScenario.write" data-arg="${esc(screen.id)}"${warn}>${write}</button>
  ${state}
</div>`
}

function caseRow(one, at) {
  return `<tr>
  <td class="sc-step">${Number(one.step) || at + 1}</td>
  <td>${esc(one.action)}</td>
  <td>${esc(one.input)}</td>
  <td>${esc(one.expect)}</td>
</tr>`
}

/** 화면 이름도 경로도 남의 문자열이다. 홑따옴표까지 막는다 (속성 안에 들어간다). */
function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const STYLE = `<style>
  body { padding: 0; }
  .sc { display: grid; grid-template-columns: 260px 1fr; height: 100vh; }
  .sc-side {
    display: flex; flex-direction: column; min-width: 0;
    border-right: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  }
  .sc-actions {
    display: flex; gap: 6px; padding: 8px 10px; flex-wrap: wrap;
    border-bottom: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  }
  .sc-actions button {
    font: inherit; color: inherit; background: none; padding: 3px 9px; border-radius: 8px;
    border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  }
  .sc-actions button:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
  .sc-rows { overflow: auto; min-height: 0; }
  .sc-row {
    display: flex; align-items: center; gap: 6px; padding: 6px 10px; min-width: 0;
    border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  }
  .sc-row.on { background: color-mix(in srgb, currentColor 10%, transparent); }
  .sc-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .sc-name > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sc-path { font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .sc-pill {
    font-size: 10px; padding: 1px 7px; border-radius: 999px; white-space: nowrap;
    border: 1px solid currentColor; opacity: 0.85;
  }
  .sc-main { overflow: auto; min-width: 0; padding: 12px 14px; }
  .sc-actions--main { border: none; padding: 12px 0 0; }
  .sc-title { margin: 0 0 2px; font-size: 15px; }
  .sc-meta {
    margin: 0 0 12px; font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .sc-step { width: 26px; text-align: right; }
  .sc-empty { margin: 0; }
</style>`

/**
 * 고르기. **문서 안에서 끝난다** — 확장을 부르지 않는다.
 *
 * 호스트가 심는 다리는 클릭을 부모로 올리지만(`data-open`·`data-command`),
 * 여기서 잡는 `data-pick` 은 그 규약이 아니라 아무 데도 안 올라간다.
 */
const SCRIPT = `<script>
(function () {
  document.addEventListener('click', function (event) {
    var hit = event.target && event.target.closest ? event.target.closest('[data-pick]') : null
    if (!hit) return
    var picked = hit.getAttribute('data-pick')

    var rows = document.querySelectorAll('.sc-row')
    for (var i = 0; i < rows.length; i += 1) {
      rows[i].classList.toggle('on', rows[i] === hit)
    }
    var panes = document.querySelectorAll('.sc-detail')
    for (var j = 0; j < panes.length; j += 1) {
      panes[j].hidden = panes[j].getAttribute('data-for') !== picked
    }
  })
})()
</script>`

module.exports = { boardHtml, mainHtml, detailHtml, rowHtml, esc, PILL }
