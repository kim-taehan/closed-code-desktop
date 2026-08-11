import type { ExtensionRow } from './extensionRows'
import { rowOpenTarget } from './extensionRowTarget'

// 확장 결과 표를 **확장자로** 좁힌다.
//
// 확장자는 확장이 준 칸에서 읽지 않고 **경로에서 직접 뽑는다.** 이유가 둘이다:
//
// 1. `file`(→ `path`)은 이미 확장 개발자와의 규약이다(`extensionRowTarget.ts`). 거기에
//    기대면 `file` 을 내는 **모든 확장**이 거르개를 공짜로 얻는다. 거르개 전용 칸을
//    새 규약으로 만들면 그 칸을 낸 확장에서만 동작한다.
// 2. 확장이 낸 칸과 경로가 어긋날 여지를 아예 없앤다. 화면이 거르는 기준은 하나여야 한다.
//
// 확장이 확장자 칸을 따로 내더라도 그것은 **보여주기 전용**이고, 거르는 판정은 여기가 한다.

/** "확장자 없음" 을 고른 상태. 빈 문자열이 그 값이라 `null`(전체)과 구분해 쓴다. */
export const NO_EXTENSION = ''

/**
 * 행이 가리키는 파일의 확장자. 점 없이 소문자. 파일 칸이 없거나 확장자가 없으면 빈 문자열.
 *
 * `.gitignore` 처럼 점으로 시작하는 이름은 확장자가 아니라 이름 자체다.
 */
export function rowExtension(row: ExtensionRow): string {
  const path = rowOpenTarget(row)?.path
  if (path === undefined) return NO_EXTENSION

  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : NO_EXTENSION
}

/**
 * 거르개에 올릴 확장자들. 이름순이고, 확장자 없는 행이 있으면 빈 문자열이 **맨 뒤**에 붙는다.
 *
 * 확장자 없는 것을 목록에서 빼지 않는다 — 빼면 `Makefile`·`.gitignore` 만 보는 방법이
 * 사라지는데, 화면에는 그 사실이 안 드러난다.
 */
export function collectExtensions(rows: ExtensionRow[]): string[] {
  const found = new Set(rows.map(rowExtension))
  const named = [...found].filter((ext) => ext !== NO_EXTENSION).sort()
  return found.has(NO_EXTENSION) ? [...named, NO_EXTENSION] : named
}

/**
 * 고른 확장자만 남긴다. `null` 이면 전부.
 *
 * 고른 확장자가 지금 행에 하나도 없으면(다시 훑어 사라졌다) **전부를 돌려준다** —
 * 빈 표를 보여주면 결과가 없는 것인지 걸러진 것인지 화면에서 구분되지 않는다.
 */
export function filterByExtension(rows: ExtensionRow[], ext: string | null): ExtensionRow[] {
  if (ext === null) return rows
  const matched = rows.filter((row) => rowExtension(row) === ext)
  return matched.length > 0 ? matched : rows
}
