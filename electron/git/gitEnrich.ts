import { readGitState } from './gitStatus'
import { readNumstat, type GitLineCount } from './gitNumstat'
import { countConflicts } from './gitConflict'
import type { GitFileEntry, GitState } from '../../shared/git/gitState'

// 상태 + 줄 수 + 충돌 개수를 한 덩어리로 조립한다.
//
// **`gitStatus.ts` 안에서 부르지 않는다.** 그쪽은 `status --porcelain` 출력을 파싱하는
// 순수 함수(`parseStatus`)와 그것을 한 번 감싼 얇은 껍데기고, 175줄짜리 테스트가 그
// 순수성을 잠그고 있다. 조회를 셋 섞으면 그 테스트가 git 세 개를 띄우게 된다.
//
// **줄 수를 따로 채널로 두지 않는다** (리더 결정, 계획 §4 의 `git:numstat` 은 철회).
// 수치·충돌 개수는 파일 목록의 **같은 행이 쓰는 값**이라 상태와 수명이 같다.
// 따로 받으면 화면이 두 응답을 맞춰 붙여야 하고, 둘이 어긋난 순간이 생긴다.
// 비용은 이 레포 실측 `diff --numstat` 409B / 10ms 수준이다.

/**
 * `readGitState` 에 `insertions`/`deletions`/`conflictCount` 를 얹어 돌려준다.
 *
 * 채우지 못한 항목은 **필드를 안 넣는다.** 0 과 없음은 다른 뜻이다 —
 * 0 은 "안 바뀜", 없음은 "모름(바이너리 or 안 셈)" (`shared/git/gitState.ts:26-35`).
 */
export async function readEnrichedGitState(root: string): Promise<GitState> {
  return enrichGitState(root, await readGitState(root))
}

/**
 * 이미 읽어 둔 상태에 수치를 얹는다.
 *
 * `refreshWithFetch`(⟳) 는 안에서 제 손으로 `readGitState` 를 부르고 `fetchFailed` 를
 * 얹어 돌려준다. 그것을 버리고 다시 읽으면 두 시점이 섞이고 `fetchFailed` 도 잃는다.
 * 그래서 **상태를 받는 입구**를 따로 둔다 — 화면으로 나가는 세 경로(초기 조회 ·
 * 행동 뒤 push · ⟳)가 전부 여기를 지나야 수치가 눌렀다 사라졌다 하지 않는다.
 */
export async function enrichGitState(root: string, state: GitState): Promise<GitState> {
  // 저장소가 아니거나 git 이 실패했으면 목록이 비어 있다. 조회를 더 돌릴 이유가 없다.
  if (!state.isRepo || state.error !== undefined) return state
  if (state.staged.length === 0 && state.unstaged.length === 0) return state

  // numstat 은 추적 안 되는 파일을 아예 안 낸다 — 골라서 넘겨야 그 행에 수치가 실린다
  const untracked = pathsWith(state, 'untracked')
  const [numstat, conflicts] = await Promise.all([
    readNumstat(root, untracked),
    countAllConflicts(root, pathsWith(state, 'conflicted')),
  ])

  return {
    ...state,
    staged: state.staged.map((entry) => withCounts(entry, numstat.staged.get(entry.path))),
    unstaged: state.unstaged.map((entry) => {
      const counted = withCounts(entry, numstat.unstaged.get(entry.path))
      const conflictCount = conflicts.get(entry.path)
      return conflictCount === undefined ? counted : { ...counted, conflictCount }
    }),
  }
}

function pathsWith(state: GitState, status: GitFileEntry['status']): string[] {
  // 충돌·추적 안 됨은 둘 다 변경사항 쪽에만 실린다 (`gitStatus.ts:62-70`)
  return state.unstaged.filter((entry) => entry.status === status).map((entry) => entry.path)
}

/**
 * 충돌 파일마다 마커를 센다.
 *
 * **충돌 파일이 없으면 파일을 한 번도 안 읽는다** — 대부분의 상태 조회가 여기 해당한다.
 * 그리고 충돌인 파일만 넘긴다: `countConflicts` 는 본문에 `<<<<<<< ` 가 든 문서
 * (머지 설명서·픽스처)도 세므로, 아무 파일에나 부르면 없는 충돌이 뜬다.
 */
async function countAllConflicts(root: string, paths: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (paths.length === 0) return counts

  const values = await Promise.all(paths.map((path) => countConflicts(root, path)))
  paths.forEach((path, at) => counts.set(path, values[at] ?? 0))
  return counts
}

function withCounts(entry: GitFileEntry, count: GitLineCount | undefined): GitFileEntry {
  if (count === undefined) return entry
  return { ...entry, insertions: count.insertions, deletions: count.deletions }
}
