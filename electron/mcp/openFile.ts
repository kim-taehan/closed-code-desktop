import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { resolveInside } from '../fs/resolveInside'

// open_file 도구가 받은 인자를 화면이 쓸 수 있는 모양으로 바꾼다.
//
// 경계 판정은 **`electron/fs/resolveInside.ts` 를 그대로 쓴다.** 여기서 따로 검사하면
// 규칙이 두 벌이 되고, 심링크나 `..` 처리가 언젠가 한쪽에서만 고쳐진다.
//
// 수용의 `resolveInside` 는 공여(develop-desktop)의 것과 두 군데가 다르다.
//
// 1. 돌려주는 것이 `{root, target}` 이 아니라 **실경로 문자열 하나**다. 상대경로를 만들려면
//    루트도 편 값이어야 해서(realpath 를 탄 target 과 짝이 맞아야 한다) 여기서 한 번 편다.
// 2. 안에서 `join(root, 상대경로)` 를 한다 — **절대경로를 받으면 루트 뒤에 이어붙는다**
//    (`join('/a','/b')` 은 `/a/b`). 모델은 절대경로를 자주 준다. 그래서 여기서 루트 기준으로
//    한 번 접어 넘긴다. **경계 판정을 여기로 옮기는 것이 아니다** — 접은 값이 루트 밖이면
//    `../…` 가 되어 `resolveInside` 가 심링크까지 풀고 거절한다. 판정은 그대로 저쪽 몫이다.

export interface OpenTarget {
  /** 프로젝트 루트 기준 상대경로. 화면은 이 모양으로만 파일을 연다. */
  path: string
  line?: number
}

/**
 * 인자를 검사하고 루트 안의 상대경로로 바꾼다. 못 쓰는 인자는 던진다 —
 * 그 말이 그대로 모델에게 가서 다시 부를 근거가 된다.
 */
export async function openTargetOf(
  root: string,
  args: Record<string, unknown>,
): Promise<OpenTarget> {
  const asked = args['path']
  if (typeof asked !== 'string' || asked.trim() === '') {
    throw new Error('path 가 필요합니다 (프로젝트 루트 기준 상대경로)')
  }

  // 루트를 한 번만 편다 — 상대경로로 접을 때와 되돌릴 때가 같은 기준이어야 한다
  const realRoot = await realpath(root).catch(() => null)
  if (realRoot === null) throw new Error('프로젝트 폴더를 읽을 수 없습니다')

  const target = await resolveInside(realRoot, isAbsolute(asked) ? relative(realRoot, asked) : asked)
  if (target === null) {
    throw new Error(`프로젝트 폴더 밖이거나 없는 경로입니다: ${asked}`)
  }

  // resolveInside 는 realpath 를 타므로 없는 경로는 이미 null 이다. 그래도 디렉토리는
  // 통과하므로 여기서 걸러 낸다 — 폴더를 탭으로 열면 화면에 빈 오류만 남는다.
  const info = await stat(target).catch(() => null)
  if (info === null || !info.isFile()) {
    throw new Error(`파일이 없습니다: ${asked}`)
  }

  const line = args['line']
  return {
    path: relative(realRoot, target),
    // 0 이나 음수는 갈 곳이 없다 — 없는 것으로 보고 파일 첫머리를 연다
    line: typeof line === 'number' && Number.isFinite(line) && line >= 1 ? line : undefined,
  }
}
