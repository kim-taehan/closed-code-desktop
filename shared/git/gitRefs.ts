// 브랜치·임시저장(스태시) 목록의 도메인 타입.
//
// 둘 다 "이름 + 시각 + 라벨" 인 참조 목록이라 성격이 같아 한 파일에 둔다.
// `gitState.ts` 에 얹지 않는 이유는 `gitCommit.ts` 머리말과 같다 — 조회 주기가 다르다.

export interface GitBranchEntry {
  /** 로컬은 `main`, 원격은 `origin/main` (`%(refname:short)`) */
  name: string
  /** 원격 추적 브랜치인가. 전환할 때 로컬을 새로 떠야 하는지가 여기서 갈린다. */
  remote: boolean
  /** 마지막 커밋 시각 (`%(committerdate:iso8601)`) — 최근 것부터 보이게 정렬하는 근거 */
  date: string
  /**
   * 업스트림 추적 문구 원문 (`%(upstream:track)`) — `[ahead 1]` · `[ahead 2, behind 3]`.
   * 업스트림이 없으면 빈 문자열.
   *
   * **git 이 낸 문구를 그대로 둔다.** 숫자로 풀어 담으면 `[gone]`(업스트림이
   * 지워짐) 처럼 숫자가 아닌 상태를 흘린다.
   */
  track: string
  /** 지금 체크아웃돼 있는 브랜치 (`%(HEAD)` 가 `*`) */
  current: boolean
}

export interface GitBranchListResult {
  ok: boolean
  branches: GitBranchEntry[]
  message?: string
}

export interface GitStashEntry {
  /** `stash@{0}` (`%gd`). 복원·버리기가 이걸로 짚는다 — 인덱스만 쓰면 목록이 밀릴 때 어긋난다. */
  ref: string
  /** 저장 시각 (`%ci`) */
  date: string
  /** `On main: 작업 중` (`%gs`) — 어느 브랜치에서 무엇을 담았는지 */
  label: string
}

export interface GitStashListResult {
  ok: boolean
  stashes: GitStashEntry[]
  message?: string
}

export interface GitStashShowResult {
  ok: boolean
  /** unified diff 원문 */
  diff: string
  /** 100KB 상한에서 잘렸는지 (`GitCommitDetail.truncated` 와 같은 뜻) */
  truncated: boolean
  message?: string
}
