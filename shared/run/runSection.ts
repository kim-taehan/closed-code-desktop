// `<프로젝트>/AGENTS.md` 의 「실행」 절 — **읽기와 쓰기가 한 파일에 있다** (설계 §2).
//
// **앱이 캐시를 따로 들지 않는다 — 파일이 곧 캐시다.** 버전 관리되고, 팀원과 공유되고,
// opencode TUI 에서도 읽힌다. 앱 저장소를 만들면 그 셋을 다 잃는다.
//
// ## 왜 파서와 라이터가 같은 파일인가
//
// 형식을 정한 것은 우리이고 **쓰는 쪽도 우리다** (`electron/mcp/saveRunCommands.ts` —
// 모델은 목록을 도구 인자로 주고, 마크다운은 여기서 짓는다). 둘이 갈리면 조용히 어긋난다:
// 쓴 것을 못 읽으면 패널이 늘 비어 보이고, 사용자에게는 "모델이 분석에 실패했다" 로 보인다.
// 왕복이 성립하는지는 `runSection.test.ts` 가 잠근다.
//
// ## 형식
//
// ```markdown
// ## 실행
//
// 이 표는 Open Code Desktop 의 「실행」 패널이 읽고 씁니다. 손으로 고쳐도 됩니다.
//
// <!-- open-code-desktop:run manifest=3f9a1c2b -->
//
// | 이름 | 명령 | 설명 |
// | --- | --- | --- |
// | dev 서버 | `npm run dev` | 개발 서버 |
// ```
//
// 고른 근거:
//   · **표** — 사람이 읽는 문서에 그대로 어울리고, 열이 이름 붙어 있어 손으로 한 줄
//     더하기가 쉽다. 목록(`- 이름: 명령`)은 설명 칸을 어디에 둘지가 사람마다 갈린다
//   · **명령은 백틱** — 이것이 곧 **항목 판정**이다. 머리줄(`| 이름 | 명령 |`)도 구분줄
//     (`| --- |`)도 둘째 칸이 백틱이 아니라, 그 하나로 셋이 갈린다. 표 문법을 따로 알 필요가 없다
//   · **지문은 HTML 주석** — 렌더된 문서에는 안 보이고, 모델에게 지시로 읽히지도 않는다.
//     우리 살림이지 사람에게 하는 말이 아니다
//
// ⚠️ **`|` 는 표를 쪼갠다.** 명령에 파이프가 들어가는 일은 흔하므로(`... | tail -n 20`)
// 쓸 때 `\|` 로 막고 읽을 때 되돌린다. 이 한 쌍이 없으면 파이프 하나로 그 줄이 통째로
// 다른 항목이 된다.

/** 절 제목. **정본은 우리가 쓴 것**이라 완전 일치로 찾는다. */
export const RUN_HEADING = '실행'

/** 지문을 싣는 주석. 사람에게 보이지 않는 자리라 값도 ASCII 로 둔다. */
const MARKER = /<!--\s*open-code-desktop:run\s+manifest=([0-9a-z]+)\s*-->/

const INTRO = '이 표는 Open Code Desktop 의 「실행」 패널이 읽고 씁니다. 손으로 고쳐도 됩니다.'

export interface RunEntry {
  /** 화면의 줄 이름이자 pty 칸 이름 (`run_project` 의 `name` 과 같은 값) */
  name: string
  command: string
  /** 있으면 이름 옆에 적는다. 없으면 칸이 빈다 */
  note?: string
}

export interface RunSection {
  entries: RunEntry[]
  /**
   * 이 목록을 만들 때의 매니페스트 지문 (`runManifest.ts`).
   *
   * null 은 **모르는 것**이지 「안 바뀌었다」가 아니다 — 사람이 손으로 적은 절에는 이 값이
   * 없고, 그때는 다시 확인할지 묻지 않는다. 안 물어보는 편이 맞다: 우리가 만들지 않은
   * 목록을 우리 판단으로 덮어쓰자고 청하는 셈이 된다.
   */
  manifest: string | null
}

/** 「실행」 절이 아예 없으면 null. **비어 있는 절과 다른 사실이다** — 화면이 그 둘을 가른다. */
export function parseRunSection(markdown: string): RunSection | null {
  const lines = markdown.split('\n')
  const found = findSection(lines)
  if (found === null) return null

  const body = lines.slice(found.start + 1, found.end)
  const entries: RunEntry[] = []
  for (const line of body) {
    const entry = entryOf(line)
    if (entry !== null) entries.push(entry)
  }
  return { entries, manifest: MARKER.exec(body.join('\n'))?.[1] ?? null }
}

/**
 * 절을 갈아 끼운 문서 전체. 절이 없으면 **끝에 덧붙인다** — 앞에 끼우면 사람이 쓴
 * 첫 문단(대개 프로젝트 소개)보다 위로 올라간다.
 *
 * 절 **밖**은 한 글자도 건드리지 않는다. AGENTS.md 는 사람과 모델이 함께 쓰는 파일이라,
 * 우리가 통째로 다시 짓는 순간 남의 글이 사라진다.
 */
export function writeRunSection(markdown: string, section: RunSection): string {
  const lines = markdown.split('\n')
  const found = findSection(lines)
  const block = renderSection(section, found?.level ?? 2)

  if (found === null) {
    const head = markdown.trimEnd()
    return head === '' ? `${block.join('\n')}\n` : `${head}\n\n${block.join('\n')}\n`
  }
  const after = lines.slice(found.end)
  return [...lines.slice(0, found.start), ...block, ...after].join('\n')
}

function renderSection(section: RunSection, level: number): string[] {
  const rows = section.entries.map(
    (entry) => `| ${escape(entry.name)} | \`${escape(entry.command)}\` | ${escape(entry.note ?? '')} |`,
  )
  return [
    `${'#'.repeat(level)} ${RUN_HEADING}`,
    '',
    INTRO,
    '',
    ...(section.manifest === null ? [] : [`<!-- open-code-desktop:run manifest=${section.manifest} -->`, '']),
    '| 이름 | 명령 | 설명 |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ]
}

/**
 * 그 줄이 항목인가. **둘째 칸이 백틱으로 감싸였는가 하나로 판정한다** —
 * 머리줄도 구분줄도 여기서 함께 걸러진다 (머리말의 근거).
 */
function entryOf(line: string): RunEntry | null {
  const cells = rowCells(line)
  if (cells === null || cells.length < 2) return null
  const command = /^`(.+)`$/.exec(cells[1] ?? '')?.[1]?.trim()
  if (command === undefined || command === '') return null
  const name = (cells[0] ?? '').trim()
  if (name === '') return null
  const note = (cells[2] ?? '').trim()
  return note === '' ? { name, command } : { name, command, note }
}

/** 표 한 줄을 칸으로 가른다. **이스케이프한 파이프(`\|`)는 칸을 안 가른다.** */
function rowCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return null
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

function escape(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/**
 * 절의 범위. **같은 깊이 이상의 다음 제목**에서 끝난다 — 더 깊은 제목(`### 주의`)은
 * 절 안이라 걸리지 않는다. 사람이 그 아래 설명을 덧붙여도 목록이 잘리지 않게 하려는 것이다.
 */
function findSection(lines: string[]): { start: number; end: number; level: number } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const heading = headingOf(lines[index] ?? '')
    if (heading === null || heading.text !== RUN_HEADING) continue

    let end = lines.length
    for (let next = index + 1; next < lines.length; next += 1) {
      const found = headingOf(lines[next] ?? '')
      if (found !== null && found.level <= heading.level) {
        end = next
        break
      }
    }
    return { start: index, end, level: heading.level }
  }
  return null
}

function headingOf(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.*)$/.exec(line)
  if (match === null) return null
  return { level: (match[1] ?? '').length, text: (match[2] ?? '').trim() }
}
