// 저장된 화면들 → 사람에게 넘길 마크다운 한 장.
//
// **저장소가 정본이고 이것은 산출물이다** (설계 §3.5). 그래서 여기서는 아무것도 판단하지
// 않는다 — 있는 것을 그대로 옮긴다. 걸러 내보내는 길은 쓰이는 것을 보고 정한다.
//
// 표 칸을 쓸 때 조심할 것 둘:
//  · `|` 가 값에 들어가면 칸이 갈라진다 → `\|` 로 막는다
//  · 줄바꿈이 들어가면 표가 그 자리에서 끝난다 → `<br>` 로 바꾼다
// 둘 다 에이전트가 쓴 문장에서 실제로 나온다 ("A | B 중 하나", 여러 줄 기대결과).

const { NONE, DRAFT, FIXED } = require('../store')

const LABEL = {
  [NONE]: '없음',
  [DRAFT]: '초안',
  [FIXED]: '확정',
}

function scenariosMarkdown(screens, when) {
  const fixed = screens.filter((one) => one.state === FIXED).length
  const head = [
    '# 화면 시나리오',
    '',
    `> 화면 ${screens.length} · 확정 ${fixed}${when ? ` · ${when}` : ''}`,
    '',
  ]

  if (screens.length === 0) {
    return [...head, '아직 만든 화면이 없습니다.', ''].join('\n')
  }

  return [...head, ...screens.flatMap(screenSection)].join('\n')
}

function screenSection(screen) {
  const lines = [
    `## ${screen.name}`,
    '',
    `\`${screen.id}\` · ${LABEL[screen.state] || LABEL[NONE]}`,
    '',
  ]

  if (screen.cases.length === 0) {
    // **빈 화면도 적는다.** 빼면 문서만 보는 사람은 그 화면이 없는 줄 안다.
    return [...lines, '시나리오가 아직 없습니다.', '']
  }

  return [
    ...lines,
    '| # | 조작 | 입력 | 기대 결과 |',
    '|---|---|---|---|',
    ...screen.cases.map(
      (one, at) =>
        `| ${Number(one.step) || at + 1} | ${cell(one.action)} | ${cell(one.input)} | ${cell(one.expect)} |`,
    ),
    '',
  ]
}

function cell(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim()
}

module.exports = { scenariosMarkdown, cell, LABEL }
