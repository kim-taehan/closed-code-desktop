import type { GitState } from '../git/gitState'

// 소스 관리 IPC 페이로드.
//
// 상태 자체(`GitState`)는 도메인 타입이라 `shared/git/gitState.ts` 에 있다.
// 여기 있는 것은 **주고받는 봉투**뿐이다.
//
// 모든 요청이 `projectId` 를 갖는다. 프로젝트를 여러 개 열어 두므로 어느 저장소를
// 묻는지 매번 밝혀야 한다 — 활성 프로젝트를 암묵적으로 쓰면, 답이 오는 사이에
// 탭을 옮겼을 때 엉뚱한 저장소를 건드린다.

export interface GitProjectPayload {
  projectId: string
}

export interface GitPathPayload {
  projectId: string
  /** 프로젝트 루트 상대 경로 */
  path: string
}

export interface GitDiffPayload {
  projectId: string
  path: string
  /**
   * 어느 묶음에서 눌렀는지.
   * true → HEAD 대비(`--staged`, 이번 커밋에 담길 것),
   * false → 인덱스 대비(아직 안 담은 변경).
   * 같은 파일이라도 둘이 다르다.
   */
  staged: boolean
}

export interface GitDiffResultPayload {
  ok: boolean
  /** unified diff 원문. 화면에서 줄 단위로 푼다. */
  diff: string
  /** 추적 안 되는 파일 — 비교 대상이 없어 diff 대신 내용을 보여줘야 한다 */
  untracked?: boolean
  reason?: string
}

/**
 * diff 덩어리(hunk) 하나를 가리킨다.
 *
 * 패치 문자열을 보내지 않는다 — **무엇을 골랐는지만** 알린다. 패치는 main 이
 * 원문 diff 를 다시 읽어 조립한다 (`electron/git/gitHunk.ts` 머리말).
 */
export interface GitHunkPayload {
  projectId: string
  /** 프로젝트 루트 상대 경로 */
  path: string
  /**
   * 몇 번째 덩어리인가 (0부터).
   *
   * ⚠ **기준은 담기 전 diff 다.** 한 덩어리를 담으면 그 덩어리가 diff 에서 빠져
   * 뒤 인덱스가 밀린다. 다음 요청 전에 화면이 diff 를 새로 받아야 한다 —
   * 밀린 인덱스를 보내면 아래 원문 대조가 잡아 거절한다(파일은 안 망가진다).
   */
  hunkIndex: number
  /**
   * 그 덩어리 원문 — 머리 한 줄(`@@ -12,7 +12,7 @@ …`) **과 그 아래 본문 줄 전부**를
   * `\n` 으로 이은 것 (끝 개행 없음). `shared/git/hunkSplit.ts` 가 만든다.
   *
   * ⚠ **화면이 그린 그대로. 손대면 거절된다.** main 은 원문 diff 를 **같은 함수로**
   * 다시 갈라 `hunkIndex` 자리의 덩어리와 **글자 그대로** 대조하고, 다르면 "그 사이
   * 파일이 바뀌었다"로 보고 거절한다. 배선·화면 어디에서도 trim·정규화·재조립하지 않는다.
   *
   * 머리 한 줄만 보내던 시절에는 **제자리 내용 변경을 못 잡았다** — 화면이 그린 뒤
   * 클릭 전에 그 덩어리가 같은 줄 수로 바뀌면 머리가 같아 통과했고, 사용자가 못 본
   * 내용이 담기거나(stage) 못 본 변경이 사라졌다(revert, 되돌릴 수 없음). QA 결함 D4.
   */
  hunkText: string
}

export interface GitCommitPayload {
  projectId: string
  message: string
}

export interface GitPushPayload {
  projectId: string
  /** 업스트림이 없을 때 만들며 올릴지. 사용자에게 한 번 묻고 정한다. */
  setUpstream?: boolean
}

/**
 * 커밋 목록 한 쪽을 묻는다.
 *
 * 쪽 크기는 **보내지 않는다.** main 의 `COMMIT_PAGE_SIZE` 하나로 고정한다 —
 * 화면이 크기를 고르게 하면 `runGit` 의 100KB 상한을 넘기는 값을 보낼 수 있고,
 * 「더 보기」에 필요한 건 "어디서부터" 뿐이다.
 */
export interface GitLogPayload {
  projectId: string
  /** 앞에서 건너뛸 커밋 수. 없으면 0(첫 쪽). */
  skip?: number
}

/**
 * **이미 있는 것**을 짚는다 — 커밋 해시(`GitCommitSummary.hash`) 또는
 * 임시저장 참조(`stash@{0}`, `GitStashEntry.ref`).
 *
 * 목록의 몇 번째인지로 짚지 않는다. 그 사이 목록이 밀리면 엉뚱한 것을 건드린다.
 */
export interface GitRefPayload {
  projectId: string
  ref: string
}

/**
 * 브랜치 이름 (`GitBranchEntry.name`). 원격이면 `origin/feat` 처럼 온다.
 *
 * `ref` 와 이름을 갈라 둔 것은 도메인 어휘를 따른 것이다 — `gitRefs.ts` 도
 * 브랜치는 `name`, 임시저장은 `ref` 로 부른다.
 */
export interface GitBranchPayload {
  projectId: string
  name: string
}

/** 임시저장에 붙일 설명. 커밋 메시지가 아니라 `GitCommitPayload` 를 돌려쓰지 않는다. */
export interface GitStashPushPayload {
  projectId: string
  message: string
}

/**
 * 변경 행동의 결과.
 *
 * 실패 메시지는 **git 이 낸 stderr 를 그대로** 쓴다. 우리가 고쳐 쓰면
 * 검색해서 찾아볼 수 없는 문장이 된다.
 */
export interface GitActionResult {
  ok: boolean
  message?: string
}

export interface GitStatePayload {
  state: GitState
}
