import { ipcMain } from 'electron'
import {
  Channel,
  type GitActionResult,
  type GitBranchPayload,
  type GitLogPayload,
  type GitProjectPayload,
  type GitRefPayload,
  type GitStashPushPayload,
} from '../../shared/ipc/channels'
import type { GitCommitDetailResult, GitLogResult } from '../../shared/git/gitCommit'
import type {
  GitBranchListResult,
  GitStashListResult,
  GitStashShowResult,
} from '../../shared/git/gitRefs'
import { readCommitDetail, readCommitPage } from '../git/gitLog'
import {
  readBranches,
  switchBranch,
  createBranch,
  trackRemoteBranch,
  mergeBranch,
  deleteBranch,
  forceDeleteBranch,
} from '../git/gitBranch'
import { readStashes, showStash, stashPush, applyStash, dropStash } from '../git/gitStash'

// 히스토리·브랜치·임시저장 IPC 등록. GitBridge 가 300줄 상한에 다가가 이 묶음만
// 갈라냈다 — 등록/해제 수명은 여전히 GitBridge 의 register()/dispose()
// (HANDLED_CHANNELS)가 쥔다 (`projectFsHandlers.ts` 와 같은 결).

/** GitBridge 가 쥔 것 중 여기서 필요한 둘. 브리지를 통째로 넘기지 않는다. */
export interface GitHistoryDeps {
  /** 열린 프로젝트의 저장소 루트. 닫혔거나 모르는 프로젝트면 null */
  rootOf(projectId: string): string | null
  /** 행동을 돌리고 새 상태를 밀어준다 */
  afterAction(
    projectId: string,
    act: (root: string) => Promise<GitActionResult>,
  ): Promise<GitActionResult>
}

const CLOSED = '열려 있지 않은 프로젝트입니다'

export function registerGitHistoryHandlers(deps: GitHistoryDeps): void {
  // ── 조회. 저장소를 안 바꾸므로 상태를 밀지 않는다.
  //
  // 닫힌 프로젝트는 실패로 답한다. `GIT_STATE` 는 빈 상태로 답하지만(그려야 할
  // 화면이 있다) 이쪽은 사용자가 그 화면을 연 뒤에만 오는 요청이라, 빈 목록으로
  // 삼키면 "히스토리가 없는 저장소" 와 구분이 안 된다.
  ipcMain.handle(Channel.GIT_LOG, (_e, p: GitLogPayload): Promise<GitLogResult> => {
    const root = deps.rootOf(p.projectId)
    if (root === null) return Promise.resolve({ ok: false, commits: [], hasMore: false, message: CLOSED })
    // 쪽 크기는 안 받는다 — main 의 COMMIT_PAGE_SIZE 하나로 고정한다 (기본값 사용).
    return readCommitPage(root, p.skip ?? 0)
  })

  ipcMain.handle(
    Channel.GIT_COMMIT_DETAIL,
    (_e, p: GitRefPayload): Promise<GitCommitDetailResult> => {
      const root = deps.rootOf(p.projectId)
      if (root === null) return Promise.resolve({ ok: false, message: CLOSED })
      return readCommitDetail(root, p.ref)
    },
  )

  ipcMain.handle(Channel.GIT_BRANCHES, (_e, p: GitProjectPayload): Promise<GitBranchListResult> => {
    const root = deps.rootOf(p.projectId)
    if (root === null) return Promise.resolve({ ok: false, branches: [], message: CLOSED })
    return readBranches(root)
  })

  ipcMain.handle(Channel.GIT_STASHES, (_e, p: GitProjectPayload): Promise<GitStashListResult> => {
    const root = deps.rootOf(p.projectId)
    if (root === null) return Promise.resolve({ ok: false, stashes: [], message: CLOSED })
    return readStashes(root)
  })

  ipcMain.handle(Channel.GIT_STASH_SHOW, (_e, p: GitRefPayload): Promise<GitStashShowResult> => {
    const root = deps.rootOf(p.projectId)
    if (root === null) return Promise.resolve({ ok: false, diff: '', truncated: false, message: CLOSED })
    return showStash(root, p.ref)
  })

  // ── 행동. 전부 `afterAction` 을 탄다 — 기존 행동 채널 11개와 같은 결이다.
  //
  // 브랜치 삭제·스태시 버리기는 `GitState`(파일 목록·브랜치 이름)를 안 바꾸지만
  // 여기서만 예외를 두지 않는다. 두 갈래 규칙을 만들면 다음 사람이 어느 쪽인지
  // 매번 판단해야 하고, 상태를 한 번 더 미는 비용보다 그 혼동이 비싸다.
  ipcMain.handle(Channel.GIT_SWITCH_BRANCH, (_e, p: GitBranchPayload) =>
    deps.afterAction(p.projectId, (root) => switchBranch(root, p.name)),
  )
  ipcMain.handle(Channel.GIT_CREATE_BRANCH, (_e, p: GitBranchPayload) =>
    deps.afterAction(p.projectId, (root) => createBranch(root, p.name)),
  )
  // 원격 이름(`origin/feat`)을 **그대로** 넘긴다 — 로컬 이름은 gitBranch 가 뗀다.
  ipcMain.handle(Channel.GIT_TRACK_BRANCH, (_e, p: GitBranchPayload) =>
    deps.afterAction(p.projectId, (root) => trackRemoteBranch(root, p.name)),
  )
  // ⚠ 충돌이 나면 ok:false 지만 저장소는 충돌 상태로 남는다. 밀려온 상태가 그것을 보여 준다.
  ipcMain.handle(Channel.GIT_MERGE_BRANCH, (_e, p: GitBranchPayload) =>
    deps.afterAction(p.projectId, (root) => mergeBranch(root, p.name)),
  )
  ipcMain.handle(Channel.GIT_DELETE_BRANCH, (_e, p: GitBranchPayload) =>
    deps.afterAction(p.projectId, (root) => deleteBranch(root, p.name)),
  )
  // ⚠ **되돌릴 수 없다** — 병합 안 된 커밋이 사라진다. 확인은 부르는 쪽이 받는다.
  // 안전한 쪽(GIT_DELETE_BRANCH)과 채널을 갈라 둔 것이 잘못 부르기를 막는 자리다.
  ipcMain.handle(Channel.GIT_FORCE_DELETE_BRANCH, (_e, p: GitBranchPayload) =>
    deps.afterAction(p.projectId, (root) => forceDeleteBranch(root, p.name)),
  )
  // ⚠ 담을 게 없어도 ok:true 로 온다 (git 이 exit 0). 부르는 쪽은 뒤이어 다시 부른
  // `gitStashes()` 로 실제로 생겼는지 판단해야 한다.
  ipcMain.handle(Channel.GIT_STASH_PUSH, (_e, p: GitStashPushPayload) =>
    deps.afterAction(p.projectId, (root) => stashPush(root, p.message)),
  )
  ipcMain.handle(Channel.GIT_APPLY_STASH, (_e, p: GitRefPayload) =>
    deps.afterAction(p.projectId, (root) => applyStash(root, p.ref)),
  )
  // ⚠ **되돌릴 수 없다.** 복원(GIT_APPLY_STASH)과 채널을 갈라 뒀다.
  ipcMain.handle(Channel.GIT_DROP_STASH, (_e, p: GitRefPayload) =>
    deps.afterAction(p.projectId, (root) => dropStash(root, p.ref)),
  )
}

/**
 * 위에서 등록한 채널 전부.
 *
 * ⚠ **GitBridge 의 `HANDLED_CHANNELS` 가 이걸 펼쳐 담는다.** 여기 한 줄을 빠뜨리면
 * 창을 다시 만들 때 그 핸들러가 샌다 — `wiring.test.ts` 두 번째 케이스가 잡는다.
 */
export const GIT_HISTORY_CHANNELS = [
  Channel.GIT_LOG,
  Channel.GIT_COMMIT_DETAIL,
  Channel.GIT_BRANCHES,
  Channel.GIT_STASHES,
  Channel.GIT_STASH_SHOW,
  Channel.GIT_SWITCH_BRANCH,
  Channel.GIT_CREATE_BRANCH,
  Channel.GIT_TRACK_BRANCH,
  Channel.GIT_MERGE_BRANCH,
  Channel.GIT_DELETE_BRANCH,
  Channel.GIT_FORCE_DELETE_BRANCH,
  Channel.GIT_STASH_PUSH,
  Channel.GIT_APPLY_STASH,
  Channel.GIT_DROP_STASH,
]
