import type { ExtensionRow } from './extensionRows'

// 확장 결과 행에서 "열 파일" 을 읽는다.
//
// **표는 행의 의미를 모른다** — 열을 데이터에서 유도할 뿐이다(`extensionRows.ts` 머리말).
// 그래서 어느 칸이 파일인지는 배선이 정해야 하고, 그 규칙이 곧 **확장 개발자와의 계약**이다.
// 지어내지 않고 여기 한 곳에 적어 둔다.
//
//   경로 : `file` → 없으면 `path`
//   줄   : `line` (1-based, 선택)
//
// 두 이름을 다 받는 이유: 둘 다 자연스러워 어느 쪽을 쓸지 확장 개발자가 반반으로 갈린다.
// 한쪽만 받으면 "행은 뜨는데 눌러도 안 열린다" 가 되고, 화면에는 단서가 남지 않는다.

/** 행이 가리키는 파일. 열 수 없는 행이면 `null`. */
export interface RowOpenTarget {
  path: string
  /** 1-based. `useOpenFiles.open(path, revealLine)` 이 그 규칙이다. */
  line?: number
}

export function rowOpenTarget(row: ExtensionRow): RowOpenTarget | null {
  const path = firstString(row, ['file', 'path'])
  if (path === null) return null

  const line = toLine(row['line'])
  return { path, ...(line !== null ? { line } : {}) }
}

function firstString(row: ExtensionRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

/**
 * 줄 번호를 고른다. 문자열로 온 것도 받는다 — 확장이 리포트를 파싱해 넘기면
 * 숫자가 문자열인 경우가 흔하고, 그 한 가지 때문에 이동이 안 되면 원인을 찾기 어렵다.
 *
 * 0·음수·소수는 버린다. `revealLine` 은 1-based 라 0 을 넘기면 엉뚱한 줄로 간다.
 */
function toLine(value: unknown): number | null {
  const numeric = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric < 1) return null
  return numeric
}
