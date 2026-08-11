import { realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'

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

/** 루트 자신이거나 그 아래여야 한다. 접두사만 보면 `/a/bc` 가 `/a/b` 안으로 잡힌다. */
function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return true
  return candidate.startsWith(root.endsWith(sep) ? root : root + sep)
}
