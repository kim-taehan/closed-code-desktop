import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, sep } from 'node:path'

// 경로 탈출 차단. 원래 `electron/projects/projectFs.ts` 안의 private 메서드였다.
//
// 여기로 뽑은 이유는 **확장 호스트(자식 프로세스)도 같은 판정을 써야** 하기 때문이다.
// `projectFs.ts` 는 `shell` 때문에 `electron` 을 import 하므로 그대로는 못 쓴다.
//
// **이 파일은 `electron` 을 import 하지 않는다.** node 만으로 돌아야
// utilityProcess 자식에서도 그대로 require 된다.
// **`shared/` 에 두지 않는다** — `shared/` 는 renderer 번들에도 실리는데
// renderer 에는 Node 가 없다 (`nodeIntegration: false`).

/**
 * 경로를 실경로로 편 뒤 루트 안인지 확인한다.
 *
 * 문자열 비교만으로는 부족하다 — `..` 는 물론이고,
 * 루트 안의 심링크가 밖을 가리키면 문자열상으로는 안쪽으로 보인다.
 *
 * 안이면 **실경로**를, 밖이거나 열 수 없으면 `null` 을 돌려준다.
 * 없는 경로도 `null` 이다 — `realpath` 가 던지기 때문이고, 그게 의도한 동작이다.
 */
export async function resolveInside(root: string, relativePath: string): Promise<string | null> {
  try {
    const resolvedRoot = await realpath(root)
    const candidate = await realpath(join(resolvedRoot, relativePath))
    return isInside(resolvedRoot, candidate) ? candidate : null
  } catch {
    return null
  }
}

/**
 * **아직 없는 자리**를 가리킬 때 쓴다 (만들기·이름 바꿔 옮기기).
 *
 * `resolveInside` 는 `realpath` 로 검사하므로 **없는 경로는 무조건 `null`** 이다 —
 * 만들려는 자리는 없는 것이 정상이라 그대로는 쓸 수 없다. 그래서 **부모를 편 뒤**
 * 이름을 붙인다: 부모는 이미 있고, 심링크가 밖을 가리키는지도 부모에서 드러난다.
 *
 * 이름 쪽은 `..` 와 절대경로를 여기서 막는다 — 부모까지만 실경로로 확인하고 나머지를
 * 그냥 이어 붙이면 `새 폴더/../../..` 한 줄로 루트를 벗어난다.
 *
 * 안이면 **만들 절대경로**를, 밖이거나 부모가 없으면 `null` 을 돌려준다.
 */
export async function resolveNewInside(root: string, relativePath: string): Promise<string | null> {
  const trimmed = relativePath.trim()
  if (trimmed === '' || isAbsolute(trimmed)) return null

  const parent = dirname(trimmed)
  const name = basename(trimmed)
  // `.` 이나 `..` 로 끝나는 것은 가리키는 자리가 없다 — 이름이 아니다
  if (name === '' || name === '.' || name === '..') return null

  const base = await resolveInside(root, parent === '.' ? '' : parent)
  if (base === null) return null

  const candidate = join(base, name)
  return isInside(base, candidate) && candidate !== base ? candidate : null
}

/** 루트 자신이거나 그 아래여야 한다. 접두사만 보면 `/a/bc` 가 `/a/b` 안으로 잡힌다. */
function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return true
  return candidate.startsWith(root.endsWith(sep) ? root : root + sep)
}
