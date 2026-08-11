import type { GitCommitDetailResult, GitLogResult } from '../git/gitCommit'
import type { GitBranchListResult, GitStashListResult, GitStashShowResult } from '../git/gitRefs'
import type {
  GitActionResult,
  GitBranchPayload,
  GitLogPayload,
  GitProjectPayload,
  GitRefPayload,
  GitStashPushPayload,
} from './gitPayloads'

// 히스토리·브랜치·임시저장 표면. `desktopBridge.ts` 가 300줄 상한에 붙어 갈라냈고
// `DesktopBridge` 가 이 인터페이스를 상속한다 — **renderer 가 보는 형태는 그대로
// `window.davis.*` 다** (`preload.ts → preloadGit.ts` 와 같은 갈래).
//
// 여기 것은 전부 **요청-응답**이다. `GitState` 처럼 밀려오지 않는다 — 사용자가
// 그 화면을 열 때만 묻는 값이라 행동마다 다시 읽을 이유가 없다
// (`shared/git/gitCommit.ts` 머리말).
//
// 다만 **저장소를 바꾸는 행동**(전환·생성·병합·치우기·복원)은 뒤이어
// `git:statePush` 로 새 `GitState` 가 밀려온다 — 기존 행동 채널과 같은 결이다.

export interface GitHistoryBridge {
  /**
   * 커밋 목록 한 쪽. `skip` 을 늘려 「더 보기」를 한다.
   *
   * ⚠ **커밋마다 파일 수가 없다.** 커밋별로 `--numstat` 을 돌려야 해서 안 싣는다 —
   * 파일 목록은 `gitCommitDetail` 에서만 온다.
   * ⚠ 커밋이 하나도 없는 저장소는 **실패가 아니라** `{ ok: true, commits: [] }` 다.
   */
  gitLog(payload: GitLogPayload): Promise<GitLogResult>
  /**
   * 커밋 하나의 요약 + 파일 목록 + diff. `ref` 는 `GitCommitSummary.hash`.
   *
   * ⚠ `detail.truncated` 가 true 면 diff 가 100KB 에서 **잘렸다.** 감추고 그리면
   * "이 커밋은 여기까지 바꿨다" 로 잘못 읽힌다.
   */
  gitCommitDetail(payload: GitRefPayload): Promise<GitCommitDetailResult>
  /**
   * 로컬 + 원격 추적 브랜치 목록.
   *
   * `entry.track` 은 git 원문(`[ahead 1]`·`[gone]`)이다 — 숫자로 풀지 말고 그대로 보인다.
   * `entry.remote` 가 true 면 `gitSwitchBranch` 가 아니라 `gitTrackBranch` 를 부른다.
   */
  gitBranches(payload: GitProjectPayload): Promise<GitBranchListResult>
  /** 임시저장 목록. 페이징 없다 — 스태시는 몇 개 수준이다. */
  gitStashes(payload: GitProjectPayload): Promise<GitStashListResult>
  /** 임시저장 하나의 내용을 diff 로 본다. `ref` 는 `GitStashEntry.ref`(`stash@{0}`). */
  gitStashShow(payload: GitRefPayload): Promise<GitStashShowResult>
  /**
   * 이미 있는 **로컬** 브랜치로 전환한다. 뒤이어 새 상태가 밀려온다.
   *
   * ⚠ 작업 중 변경이 전환할 브랜치와 겹칠 때만 실패한다 — 겹치지 않으면 git 이
   * 수정을 그대로 데려간다. 실패 문구는 git 원문(`Your local changes to the
   * following files would be overwritten…`)이다.
   */
  gitSwitchBranch(payload: GitBranchPayload): Promise<GitActionResult>
  /** 지금 HEAD 에서 새 브랜치를 떠서 전환한다. 뒤이어 새 상태가 밀려온다. */
  gitCreateBranch(payload: GitBranchPayload): Promise<GitActionResult>
  /**
   * 원격 브랜치를 로컬로 받아 전환한다 (`origin/feat` → 로컬 `feat`).
   *
   * `name` 에 **원격 이름을 그대로** 넘긴다 — 앞의 `origin/` 은 main 이 뗀다.
   * 원격 브랜치에 `gitSwitchBranch` 를 쓰면 git 이 거절한다.
   */
  gitTrackBranch(payload: GitBranchPayload): Promise<GitActionResult>
  /**
   * 다른 브랜치를 지금 브랜치에 병합한다. 뒤이어 새 상태가 밀려온다.
   *
   * ⚠ 충돌이 나면 `ok:false` 에 git 의 안내가 실리고 **저장소는 충돌 상태로 남는다.**
   * 밀려온 상태의 `conflicted` 파일이 그 사실을 보여 준다 — 해결은 아직 화면 밖이다.
   */
  gitMergeBranch(payload: GitBranchPayload): Promise<GitActionResult>
  /**
   * 브랜치를 지운다 (**안전한 쪽**). 병합 안 된 브랜치는 git 이 거절한다 —
   * `the branch 'x' is not fully merged`.
   */
  gitDeleteBranch(payload: GitBranchPayload): Promise<GitActionResult>
  /**
   * 브랜치를 강제로 지운다. **병합 안 된 커밋이 사라지고 되돌릴 수 없다.**
   *
   * 안전한 쪽과 **채널을 갈라 뒀다** — 플래그 한 글자 차이로 잘못 부르지 않게.
   * 부르는 쪽이 사용자에게 한 번 확인받은 뒤에만 부른다.
   */
  gitForceDeleteBranch(payload: GitBranchPayload): Promise<GitActionResult>
  /**
   * 지금 변경을 치워 둔다. 뒤이어 새 상태가 밀려온다.
   *
   * ⚠ **담을 게 없어도 성공(`ok:true`)으로 온다** — git 이 `No local changes to save`
   * 를 내고 exit 0 이다(실측). 이 결과만 보고 "저장했다" 고 말하면 안 된다.
   * 실제로 생겼는지는 뒤이어 다시 부른 `gitStashes()` 로 판단한다.
   * ⚠ 커밋이 하나도 없는 저장소에서는 실패한다 (`You do not have the initial commit yet`).
   */
  gitStashPush(payload: GitStashPushPayload): Promise<GitActionResult>
  /**
   * 치워 둔 것을 작업트리로 되돌린다. **목록에는 그대로 남는다.**
   * 뒤이어 새 상태가 밀려온다.
   */
  gitApplyStash(payload: GitRefPayload): Promise<GitActionResult>
  /**
   * 치워 둔 것을 버린다. **되돌릴 수 없다** — 복원(`gitApplyStash`)과 채널을 갈라 뒀다.
   * 부르는 쪽이 사용자에게 한 번 확인받은 뒤에만 부른다.
   */
  gitDropStash(payload: GitRefPayload): Promise<GitActionResult>
}
