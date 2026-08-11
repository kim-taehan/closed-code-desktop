// git 상태의 도메인 타입.
//
// IPC 페이로드가 아니라 도메인 타입이라 `shared/ipc/` 가 아니라 여기 둔다.
// 메인·렌더러 양쪽이 같은 것을 봐야 해서 shared 에 있다.

/**
 * 화면에 한 글자로 보이는 상태.
 *
 * git 의 XY 두 글자를 그대로 노출하지 않는다 — 사용자는 인덱스와 워크트리를
 * 구분해 읽을 이유가 없고, 어느 묶음에 들어 있느냐가 이미 그것을 말해 준다.
 */
export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'

export interface GitFileEntry {
  /** 프로젝트 루트 상대 경로. 파일 트리와 같은 형태라 그대로 맞물린다. */
  path: string
  status: GitFileStatus
  /** 이름이 바뀐 경우의 옛 경로 */
  oldPath?: string
  /**
   * 이 파일의 추가·삭제 줄 수 (`electron/git/gitNumstat.ts`).
   *
   * **없을 수 있다.** 바이너리는 줄 수라는 게 없고, 상태만 읽고 수치는 안 물은
   * 경로도 있다. 0 과 구분해야 한다 — 0 은 "안 바뀜", 없음은 "모름"이다.
   */
  insertions?: number
  deletions?: number
  /** 충돌 지점 개수 (`electron/git/gitConflict.ts`). 충돌 파일에만 실린다. */
  conflictCount?: number
}

export interface GitState {
  isRepo: boolean
  /** 분리된 HEAD 이거나 커밋이 하나도 없으면 null */
  branch: string | null
  /** 업스트림 브랜치 이름. 없으면 null — 푸시할 때 만들지 물어야 한다. */
  upstream: string | null
  /** 아직 안 올린 내 커밋 / 아직 안 받은 원격 커밋. 마지막으로 받아온 원격 기준이다. */
  ahead: number
  behind: number
  staged: GitFileEntry[]
  unstaged: GitFileEntry[]
  /** git 을 못 돌린 사유. 있으면 나머지는 비어 있다. */
  error?: string
  /**
   * 마지막 ⟳ 에서 원격 확인(fetch)이 실패했는지. 사내망 밖이면 참이다.
   * 참일 때 화살표는 '확인 안 됨' — ahead/behind 가 최신이 아니기 때문이다.
   */
  fetchFailed?: boolean
}

export const EMPTY_GIT_STATE: GitState = {
  isRepo: false,
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
}
