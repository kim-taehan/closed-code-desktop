import { useState } from 'react'
import { deriveColumns, formatCell, type ExtensionRow } from '../state/extensionRows'
import { nextSort, sortRows, type RowSort } from '../state/extensionRowSort'

// 확장이 넘긴 행들을 표로 그린다 (`contributes.views[].kind === 'table'`).
//
// **열을 하드코딩하지 않는다.** 확장마다 행의 모양이 다르고, 앱은 어느 확장이
// 깔릴지 미리 모른다 — 열은 데이터에서 유도한다 (`extensionRows.ts`).
//
// 정렬 상태는 **부르는 쪽이 쥔다.** 이 표는 거른 뒤의 행을 받는데, 거르개가 바뀔 때마다
// 표가 다시 마운트되면 정렬이 풀린다.

/**
 * 처음에 그리는 행 수.
 *
 * **상한이 아니라 첫 묶음이다** — 나머지는 「외 n개」를 눌러 펼친다. 조용히 자르지 않는다
 * (GitPanel 과 같은 규칙).
 *
 * 처음부터 전부 그리지 않는 이유는 좁은 사이드바에서 수천 행이면 칸이 수만 개가 되어
 * 스크롤이 버벅이기 때문이다. 대부분은 위쪽만 보고 끝난다.
 */
const FIRST_PAGE = 200

/**
 * 남는 너비를 다 가져갈 칸.
 *
 * 좁은 사이드바에서 제일 중요한 것은 **어느 파일인가**인데, 균등 분배(`table-layout: fixed`)
 * 로 두면 경로가 먼저 잘리고 `lines`·`ext` 같은 짧은 칸이 빈 자리를 낭비한다.
 * 어느 칸이 경로인지는 이미 규약으로 정해져 있다 (`extensionRowTarget.ts`).
 */
const PATH_COLUMNS = ['file', 'path']

export interface ExtensionTableProps {
  rows: ExtensionRow[]
  /**
   * 행을 눌렀을 때. **주지 않으면 행은 누를 수 없다.**
   * 행의 어느 칸이 파일인지는 확장이 아는 것이라, 그 해석은 이 표가 하지 않는다.
   */
  onOpenRow?: (row: ExtensionRow) => void
  /** 지금 정렬. `null` 이면 확장이 준 순서 그대로 */
  sort?: RowSort | null
  /** 열 머리를 눌렀을 때. 주지 않으면 열 머리는 누를 수 없다 */
  onSort?: (sort: RowSort | null) => void
}

export function ExtensionTable({ rows, onOpenRow, sort = null, onSort }: ExtensionTableProps) {
  // 훅은 이른 반환보다 위에 둔다 — 아래 `rows.length === 0` 뒤에 두면 렌더마다 훅 수가 달라진다
  const [showAll, setShowAll] = useState(false)

  if (rows.length === 0) return <p className="ext-empty">아직 결과가 없습니다.</p>

  // 열은 **자르기 전(전체 행)** 기준으로 뽑고, 정렬도 전체에 건다 —
  // 보이는 것만 정렬하면 "제일 큰 것" 이 뒤쪽에 숨어 있을 때 올라오지 않는다.
  const columns = deriveColumns(rows)
  const sorted = sortRows(rows, sort)
  const shown = showAll ? sorted : sorted.slice(0, FIRST_PAGE)
  const hidden = sorted.length - shown.length

  return (
    <>
      <table className="ext-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} className={classOf(column)} aria-sort={ariaSort(sort, column)}>
                {onSort ? (
                  <button
                    type="button"
                    className="ext-table__sort"
                    onClick={() => onSort(nextSort(sort, column))}
                  >
                    {column}
                    {/* 방향 표시는 지금 정렬 중인 열에만. 전부에 붙이면 어느 것이 켜졌는지 흐려진다 */}
                    {sort?.column === column && (
                      <span className="ext-table__arrow">{sort.direction === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </button>
                ) : (
                  column
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr
              // 확장이 정한 행에 안정된 식별자가 있다는 보장이 없다. 순서를 키로 쓴다 —
              // 결과는 통째로 교체되므로 부분 갱신으로 어긋날 자리가 없다.
              key={index}
              className={onOpenRow ? 'ext-table__row ext-table__row--open' : 'ext-table__row'}
              {...(onOpenRow
                ? {
                    onClick: () => onOpenRow(row),
                    tabIndex: 0,
                    onKeyDown: (event: React.KeyboardEvent) => {
                      if (event.key === 'Enter') onOpenRow(row)
                    },
                  }
                : {})}
            >
              {columns.map((column) => (
                <td key={column} className={classOf(column)} title={formatCell(row[column])}>
                  {formatCell(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && (
        <button type="button" className="ext-more" onClick={() => setShowAll(true)}>
          외 {hidden}개 — 전부 보기
        </button>
      )}
    </>
  )
}

function classOf(column: string): string | undefined {
  return PATH_COLUMNS.includes(column) ? 'ext-table__path' : undefined
}

/** 스크린리더가 정렬 상태를 읽는 자리. 화살표는 눈으로만 보인다. */
function ariaSort(sort: RowSort | null, column: string): 'ascending' | 'descending' | 'none' {
  if (sort?.column !== column) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}
