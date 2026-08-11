// 커밋 히스토리의 도메인 타입.
//
// **`gitState.ts` 에 얹지 않는다.** `GitState` 는 행동 뒤마다 다시 읽혀 화면으로
// 밀리는 값이고(`GIT_STATE_PUSH`), 히스토리는 사용자가 그 화면을 열 때만 묻는
// 값이다. 한 파일에 담으면 "파일 하나 담을 때마다 log 도 같이 돌아야 한다"는
// 오해를 부른다 (계획 §2 결정 #8 — 새 조회는 요청-응답 채널로 둔다).

export interface GitCommitSummary {
  /** 40자 전체 해시. 커밋을 다시 물을 때 이걸로 짚는다. */
  hash: string
  /** 화면에 보이는 짧은 해시 (%h) */
  shortHash: string
  author: string
  /** ISO 8601 (%aI). 화면 쪽에서 상대시각으로 푼다. */
  date: string
  /**
   * 이 커밋에 붙은 라벨 (%D 를 쉼표로 가른 것) — `HEAD -> main` · `origin/main` ·
   * `tag: v1.0`. 화면의 배지가 여기서 나온다. 라벨이 없는 커밋은 빈 배열.
   */
  refs: string[]
  /** 커밋 메시지 첫 줄 (%s). 여러 줄이면 git 이 공백으로 이어 한 줄로 준다 (실측). */
  subject: string
}

/**
 * 커밋 하나가 건드린 파일.
 *
 * `insertions`/`deletions` 가 **없으면 바이너리**다 (numstat 이 `-`로 준다).
 * 0 과 구분해야 한다 — 0 은 "안 바뀜", 없음은 "줄 수라는 게 없음"이다.
 * (`shared/git/gitState.ts` 의 `GitFileEntry` 와 같은 결)
 */
export interface GitFileChange {
  path: string
  /** 이름이 바뀐 경우의 옛 경로 */
  oldPath?: string
  insertions?: number
  deletions?: number
}

export interface GitCommitDetail {
  commit: GitCommitSummary
  files: GitFileChange[]
  /** unified diff 원문. 화면에서 줄 단위로 푼다. */
  diff: string
  /**
   * diff 가 100KB 상한에서 잘렸는지 (`GitResult.stdoutTruncated`).
   *
   * **조용히 자르지 않는다.** 커밋 하나의 diff 는 상한을 넘을 수 있고, 잘린 줄
   * 모르고 보면 "이 커밋은 여기까지 바꿨다" 로 잘못 읽힌다.
   */
  truncated: boolean
}

export interface GitLogResult {
  ok: boolean
  commits: GitCommitSummary[]
  /** 다음 페이지가 있는지. 「더 보기」를 띄울지가 여기서 갈린다. */
  hasMore: boolean
  /** 실패 사유 — git 이 낸 stderr 원문 */
  message?: string
}

export interface GitCommitDetailResult {
  ok: boolean
  detail?: GitCommitDetail
  message?: string
}
