import type { GitFileEntry, GitFileStatus, GitState } from '../../shared/git/gitState'

// 상태 → 글자 대응표. **한 벌만 둔다** — 패널과 파일 트리가 같은 글자를 써야
// 두 곳을 번갈아 봐도 같은 것을 뜻한다는 게 분명하다.

export const STATUS_LETTER: Record<GitFileStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: '?',
  conflicted: '!',
}

/** 경로 → 상태. 트리가 한 줄씩 조회한다. */
export type GitBadgeMap = Map<string, GitFileStatus>

/**
 * 두 묶음을 하나의 조회표로 합친다.
 *
 * 한 파일이 양쪽에 있으면(`MM`) **변경사항 쪽을 쓴다** — 트리는 디스크에 있는
 * 파일을 보여주는 곳이라, 아직 담지 않은 변경이 지금 파일의 모습이기 때문이다.
 */
export function buildBadges(state: GitState): GitBadgeMap {
  const badges: GitBadgeMap = new Map()
  const put = (entry: GitFileEntry) => badges.set(entry.path, entry.status)

  state.staged.forEach(put)
  state.unstaged.forEach(put)
  return badges
}

/**
 * 이 폴더 아래에 변경이 있는지.
 *
 * 개수를 세지 않고 있는지만 본다 — 트리는 펼친 곳만 읽으므로 정확한 수를 알 수 없고,
 * 틀린 수를 보여주느니 안 보여주는 편이 낫다.
 */
export function hasChangesUnder(badges: GitBadgeMap, dirPath: string): boolean {
  const prefix = `${dirPath}/`
  for (const path of badges.keys()) {
    if (path.startsWith(prefix)) return true
  }
  return false
}
