import { deriveColumns, formatCell, type ExtensionRow } from './extensionRows'

// 확장 결과 표를 CSV 글자로.
//
// 표가 열을 데이터에서 유도하듯(`extensionRows.ts`) 여기도 같은 함수를 쓴다 —
// **화면에 보이는 열이 곧 내보내는 열**이어야 하고, 규칙이 두 벌이면 언젠가 어긋난다.
//
// 파일로 쓰는 것은 main 이 한다 (`extension:exportCsv`). 여기는 글자만 만든다.

/**
 * 줄 끝은 CRLF 다.
 *
 * RFC 4180 이 그렇게 정했고, Excel 이 그 기준으로 읽는다. LF 만 쓰면 Windows 판 Excel 에서
 * 줄이 안 갈리는 경우가 있다. 이 값을 보는 곳이 대개 Excel 이라 표준 쪽을 따른다.
 */
const CRLF = '\r\n'

/**
 * 칸 하나를 CSV 로.
 *
 * **따옴표·쉼표·줄바꿈이 있으면 감싼다.** 확장이 무엇을 넣을지 앱이 정하지 않으므로
 * 경로에 쉼표가, 값에 줄바꿈이 들어올 수 있다 — 안 감싸면 그 행부터 칸이 밀린다.
 *
 * 앞이 `=`·`+`·`-`·`@` 인 값은 작은따옴표를 앞에 붙인다. Excel 이 그것을 **수식으로 실행**해서다
 * (CSV injection). 파일 경로가 `-` 로 시작하는 것은 드물지 않고, 여는 쪽은 우리가 아니다.
 */
function cell(value: unknown): string {
  const text = formatCell(value)
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /["\n\r,]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/**
 * 행들을 CSV 로. 첫 줄은 열 이름이다.
 *
 * 행이 없으면 **빈 문자열**을 돌려준다 — 머리글만 있는 파일을 만들면 "내보내기가 됐는데
 * 내용이 없다" 와 "내보낼 것이 없다" 가 파일 안에서 구분되지 않는다. 부르는 쪽이 막는다.
 */
export function rowsToCsv(rows: ExtensionRow[]): string {
  if (rows.length === 0) return ''

  const columns = deriveColumns(rows)
  const header = columns.map(cell).join(',')
  const body = rows.map((row) => columns.map((column) => cell(row[column])).join(','))
  return [header, ...body].join(CRLF) + CRLF
}

/**
 * 저장 대화상자에 채워 둘 이름.
 *
 * 뷰 제목을 쓴다 — 사용자가 화면에서 본 이름이라 어느 표인지 바로 안다.
 *
 * 파일 이름 자리에 들어가므로 경로 구분자와 예약 문자를 뺀다. 매니페스트의 제목은
 * 사람이 손으로 쓴 값이라 무엇이든 올 수 있다. **띄어쓰기는 남긴다** — 못 쓸 문자가
 * 아니고, 지우면 사용자가 화면에서 본 이름과 달라진다.
 *
 * 이 값은 대화상자의 기본값일 뿐이고 최종 경로는 사용자가 고른다 (`ExtensionBridge.exportCsv`).
 */
export function csvFileName(viewTitle: string): string {
  const safe = viewTitle.replace(/[/\\:*?"<>|]/g, '').trim()
  return `${safe === '' ? '확장 결과' : safe}.csv`
}
