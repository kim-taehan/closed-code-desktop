import type { DirEntryPayload } from '../../shared/ipc/channels'
import type { TreeChildren } from './useFileTree'

// 파일 트리의 **화살표 조작** 판단 (IntelliJ 의 프로젝트 창과 같은 규칙).
//
// 그리기(`FileTree.tsx`)와 갈라 둔다 — 여기 있는 것은 전부 순수 함수라 화면 없이 잠글 수
// 있고, 「지금 어디로 가야 하나」가 렌더 트리를 훑는 일과 섞이지 않는다.
//
// **보이는 줄만 오간다.** 접힌 폴더 안은 화면에 없으므로 ↓ 로 들어가지지 않는다 —
// 화면에 없는 것으로 커서가 사라지면 사용자는 트리가 멈춘 것으로 겪는다.
//
// 초점 자리는 **하나뿐이다**(roving tabindex). 줄마다 tab 이 서면 903줄짜리 트리에서
// Tab 한 번에 사이드바를 못 빠져나간다.

/** 화면에 실제로 그려지는 줄 하나. 순서가 곧 위아래 순서다. */
export interface VisibleRow {
  path: string
  isDirectory: boolean
  /** 들여쓰기 칸. ← 로 부모를 찾을 때 이 값으로 거슬러 올라간다 */
  depth: number
}

/**
 * 렌더 순서 그대로 납작하게 편다.
 *
 * **안 읽힌 폴더는 자식이 없다.** 펼치기는 눌렀는데 아직 안 들어온 폴더가 있는데
 * (`loading`), 그 안을 있다고 치면 →/↓ 가 없는 줄로 간다.
 */
export function visibleRows(children: TreeChildren, expanded: ReadonlySet<string>): VisibleRow[] {
  const rows: VisibleRow[] = []

  const walk = (entries: DirEntryPayload[] | undefined, depth: number) => {
    if (entries === undefined) return
    for (const entry of entries) {
      rows.push({ path: entry.path, isDirectory: entry.isDirectory, depth })
      if (entry.isDirectory && expanded.has(entry.path)) walk(children[entry.path], depth + 1)
    }
  }

  walk(children[''], 0)
  return rows
}

/**
 * 키 하나에 대한 답.
 *
 * `move` 는 초점만 옮기고, `open` 은 파일을 연다. 펼치고 접는 것은 **셋으로 가른다** —
 * `toggle` 은 뒤집기(Enter), `expand`·`collapse` 는 한쪽으로만 간다. 화살표를 뒤집기로
 * 두면 **이미 펼친 빈 폴더에서 → 가 그 폴더를 접는다** (자식이 없어 「자식으로」가 안 되고
 * 뒤집기만 남으므로). 방향키가 반대로 도는 셈이라 여기서 뜻을 갈라 둔다.
 *
 * **아무것도 아닌 키는 `null`** — 부르는 쪽이 `preventDefault` 를 걸지 말지를 이걸로 가른다.
 * 다 삼키면 트리 안에서 Tab·글자 입력이 통째로 죽는다.
 */
export type TreeKeyAction =
  | { kind: 'move'; path: string }
  | { kind: 'toggle'; path: string }
  | { kind: 'expand'; path: string }
  | { kind: 'collapse'; path: string }
  | { kind: 'open'; path: string }

/**
 * @param current 지금 초점이 있는 경로. 없으면 첫 줄부터 시작한다.
 *
 * 규칙은 IntelliJ 를 따른다:
 *  · ↑↓ — 보이는 줄을 위아래로
 *  · → — 접힌 폴더면 펼치고, 이미 펼쳤으면 **첫 자식으로**. 파일에는 갈 곳이 없다
 *  · ← — 펼친 폴더면 접고, 아니면 **부모로**. 깊이 들어갔다 한 번에 나오는 길이 이것이다
 *  · Enter — 폴더는 펼치고/접고, 파일은 연다 (누르는 것과 같다)
 *  · Home/End — 처음/끝
 */
export function treeKeyAction(
  rows: readonly VisibleRow[],
  current: string | null,
  key: string,
): TreeKeyAction | null {
  if (rows.length === 0) return null

  const at = current === null ? -1 : rows.findIndex((row) => row.path === current)
  // 초점이 사라졌거나(폴더를 접어 자식이 숨었다) 아직 없으면 첫 줄로 데려간다.
  // **위아래 키에서만** 그렇게 한다 — ←→ 는 겨눌 줄이 있어야 뜻이 있다.
  if (at === -1) return key === 'ArrowDown' || key === 'ArrowUp' ? { kind: 'move', path: rows[0]!.path } : null

  const row = rows[at]!

  if (key === 'ArrowDown') return at + 1 < rows.length ? { kind: 'move', path: rows[at + 1]!.path } : null
  if (key === 'ArrowUp') return at > 0 ? { kind: 'move', path: rows[at - 1]!.path } : null
  if (key === 'Home') return { kind: 'move', path: rows[0]!.path }
  if (key === 'End') return { kind: 'move', path: rows[rows.length - 1]!.path }

  if (key === 'Enter') return row.isDirectory ? { kind: 'toggle', path: row.path } : { kind: 'open', path: row.path }

  if (key === 'ArrowRight') {
    if (!row.isDirectory) return null
    // 다음 줄이 **더 깊으면** 펼쳐져 있고 자식도 들어온 것이다 → 첫 자식으로.
    // 아니면(닫혔거나 아직 안 읽혔거나 빈 폴더거나) 펼치기만 건다.
    return hasVisibleChild(rows, at)
      ? { kind: 'move', path: rows[at + 1]!.path }
      : { kind: 'expand', path: row.path }
  }

  if (key === 'ArrowLeft') {
    // 펼쳐져 있으면(자식이 보이면) 접는다. 빈 폴더·안 읽힌 폴더는 접을 것이 없으므로
    // 부모로 올라간다 — 눌렀는데 아무 일도 안 일어나는 것보다 낫다.
    if (hasVisibleChild(rows, at)) return { kind: 'collapse', path: row.path }
    return parentOf(rows, at)
  }

  return null
}

/** 자식이 **화면에 떠 있나.** 펼쳤어도 아직 안 읽혔으면 거짓이다 — 갈 줄이 없다. */
function hasVisibleChild(rows: readonly VisibleRow[], at: number): boolean {
  const child = rows[at + 1]
  return child !== undefined && child.depth > rows[at]!.depth
}

/** 나보다 얕은 줄 중 **바로 위**의 것. 루트 줄이면 갈 곳이 없다. */
function parentOf(rows: readonly VisibleRow[], at: number): TreeKeyAction | null {
  const depth = rows[at]!.depth
  for (let back = at - 1; back >= 0; back -= 1) {
    if (rows[back]!.depth < depth) return { kind: 'move', path: rows[back]!.path }
  }
  return null
}
