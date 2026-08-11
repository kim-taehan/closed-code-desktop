import type { ExtensionRow } from './extensionRows'

// 확장 결과 표를 **열 머리를 눌러** 다시 정렬한다.
//
// 확장이 이미 자기 기준으로 정렬해 넘기지만, 무엇을 보고 싶은지는
// 그때그때 다르다. 표가 열을 데이터에서 유도하듯 정렬 판정도 **값의 모양에서** 유도한다 —
// 어느 칸이 수인지 앱이 미리 알 수 없기 때문이다.
//
// ⚠️ **여기 온 행 안에서만 정렬한다.** 확장이 상한을 걸어 잘라 보냈다면, 잘려 나간 것은
// 어떤 정렬로도 돌아오지 않는다 — 그 상한은 확장이 자기 README 에 밝힐 몫이다.

export type SortDirection = 'asc' | 'desc'

export interface RowSort {
  column: string
  direction: SortDirection
}

/**
 * 열 머리를 눌렀을 때의 다음 정렬 상태.
 *
 * 다른 열을 누르면 **내림차순으로 시작한다** — 크기·줄 수처럼 "많은 것부터" 보려고 누르는
 * 경우가 대부분이고, 오름차순으로 시작하면 한 번 더 눌러야 한다.
 * 같은 열을 누르면 뒤집고, 세 번째로 누르면 정렬을 푼다(확장이 준 원래 순서로).
 */
export function nextSort(current: RowSort | null, column: string): RowSort | null {
  if (current === null || current.column !== column) return { column, direction: 'desc' }
  if (current.direction === 'desc') return { column, direction: 'asc' }
  return null
}

/**
 * 정렬한 사본. `sort` 가 `null` 이면 확장이 준 순서 그대로다.
 *
 * 값이 **양쪽 다 수면 수로, 아니면 글자로** 비교한다. 수 칸을 글자로 비교하면
 * `11507` 이 `9` 보다 앞에 온다.
 *
 * 값이 없는 행(`lines` 를 못 센 큰 파일)은 방향과 무관하게 **항상 뒤로** 보낸다.
 * 없는 값을 0 이나 빈 문자열로 치면 "제일 작은 것" 인 척하게 되는데, 못 센 것과
 * 0 인 것은 다르다.
 */
export function sortRows(rows: ExtensionRow[], sort: RowSort | null): ExtensionRow[] {
  if (sort === null) return rows

  const factor = sort.direction === 'asc' ? 1 : -1
  return rows.slice().sort((a, b) => {
    const left = a[sort.column]
    const right = b[sort.column]

    const leftEmpty = isEmpty(left)
    const rightEmpty = isEmpty(right)
    if (leftEmpty || rightEmpty) return leftEmpty && rightEmpty ? 0 : leftEmpty ? 1 : -1

    if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor
    return String(left).localeCompare(String(right)) * factor
  })
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}
