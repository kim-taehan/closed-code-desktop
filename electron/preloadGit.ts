import { ipcRenderer } from 'electron'
import { Channel, type DesktopBridge, type ProjectHandler } from '../shared/ipc/channels'
import type {
  GitActionResult,
  GitBranchPayload,
  GitCommitPayload,
  GitDiffPayload,
  GitDiffResultPayload,
  GitHunkPayload,
  GitLogPayload,
  GitPathPayload,
  GitProjectPayload,
  GitPushPayload,
  GitRefPayload,
  GitStashPushPayload,
  GitStatePayload,
} from '../shared/ipc/gitPayloads'
import type { GitCommitDetailResult, GitLogResult } from '../shared/git/gitCommit'
import type {
  GitBranchListResult,
  GitStashListResult,
  GitStashShowResult,
} from '../shared/git/gitRefs'

// 소스 관리 배선. preload.ts 가 300줄 상한에 붙어 있어 git 만 떼어 냈고,
// preload.ts 가 spread 로 다시 합친다 — **노출 형태와 메서드 이름은 그대로다**.
//
// ⚠ `wiring.test.ts` 는 `preload*.ts` 를 정규식으로 훑어 invoke 하는 채널을 뽑는다.
// 배선을 또 다른 파일로 가를 때 그 스캔 범위를 함께 넓혀야 한다 — 안 그러면
// 검사가 아무것도 안 보면서 초록이 된다.

/** 겉봉(ProjectScoped)을 벗기는 구독 헬퍼. preload.ts 의 것을 넘겨받는다 — 두 벌을 만들지 않는다. */
type Subscribe = <T>(channel: string, handler: ProjectHandler<T>) => () => void

type GitBridge = Pick<
  DesktopBridge,
  | 'gitState'
  | 'onGitState'
  | 'gitFileDiff'
  | 'gitStage'
  | 'gitUnstage'
  | 'gitRevert'
  | 'gitStageHunk'
  | 'gitRevertHunk'
  | 'gitCommit'
  | 'gitPush'
  | 'gitPull'
  | 'gitStageAll'
  | 'gitUnstageAll'
  | 'gitAmend'
  | 'gitUndoCommit'
  | 'gitRefresh'
  | 'gitLog'
  | 'gitCommitDetail'
  | 'gitBranches'
  | 'gitStashes'
  | 'gitStashShow'
  | 'gitSwitchBranch'
  | 'gitCreateBranch'
  | 'gitTrackBranch'
  | 'gitMergeBranch'
  | 'gitDeleteBranch'
  | 'gitForceDeleteBranch'
  | 'gitStashPush'
  | 'gitApplyStash'
  | 'gitDropStash'
>

export function gitBridge(subscribe: Subscribe): GitBridge {
  return {
    gitState: (payload: GitProjectPayload) =>
      ipcRenderer.invoke(Channel.GIT_STATE, payload) as Promise<GitStatePayload>,
    onGitState: (handler: ProjectHandler<GitStatePayload>) =>
      subscribe<GitStatePayload>(Channel.GIT_STATE_PUSH, handler),
    gitFileDiff: (payload: GitDiffPayload) =>
      ipcRenderer.invoke(Channel.GIT_FILE_DIFF, payload) as Promise<GitDiffResultPayload>,
    gitStage: (payload: GitPathPayload) =>
      ipcRenderer.invoke(Channel.GIT_STAGE, payload) as Promise<GitActionResult>,
    gitUnstage: (payload: GitPathPayload) =>
      ipcRenderer.invoke(Channel.GIT_UNSTAGE, payload) as Promise<GitActionResult>,
    gitRevert: (payload: GitPathPayload) =>
      ipcRenderer.invoke(Channel.GIT_REVERT, payload) as Promise<GitActionResult>,
    // 덩어리 단위. 페이로드를 **그대로** 넘긴다 — `hunkText` 를 여기서 손대면
    // main 의 원문 대조가 매번 어긋나 사용자에게는 "새로 고치라"만 보인다.
    gitStageHunk: (payload: GitHunkPayload) =>
      ipcRenderer.invoke(Channel.GIT_STAGE_HUNK, payload) as Promise<GitActionResult>,
    gitRevertHunk: (payload: GitHunkPayload) =>
      ipcRenderer.invoke(Channel.GIT_REVERT_HUNK, payload) as Promise<GitActionResult>,
    gitCommit: (payload: GitCommitPayload) =>
      ipcRenderer.invoke(Channel.GIT_COMMIT, payload) as Promise<GitActionResult>,
    gitPush: (payload: GitPushPayload) =>
      ipcRenderer.invoke(Channel.GIT_PUSH, payload) as Promise<GitActionResult>,
    gitPull: (payload: GitProjectPayload) =>
      ipcRenderer.invoke(Channel.GIT_PULL, payload) as Promise<GitActionResult>,
    gitStageAll: (payload: GitProjectPayload) =>
      ipcRenderer.invoke(Channel.GIT_STAGE_ALL, payload) as Promise<GitActionResult>,
    gitUnstageAll: (payload: GitProjectPayload) =>
      ipcRenderer.invoke(Channel.GIT_UNSTAGE_ALL, payload) as Promise<GitActionResult>,
    gitAmend: (payload: GitCommitPayload) =>
      ipcRenderer.invoke(Channel.GIT_AMEND, payload) as Promise<GitActionResult>,
    gitUndoCommit: (payload: GitProjectPayload) =>
      ipcRenderer.invoke(Channel.GIT_UNDO_COMMIT, payload) as Promise<GitActionResult>,
    gitRefresh: (payload: GitProjectPayload) =>
      ipcRenderer.invoke(Channel.GIT_REFRESH, payload) as Promise<void>,

    // 히스토리·브랜치·임시저장. 조회는 밀려오지 않고 물을 때만 온다.
    gitLog: (payload: GitLogPayload) =>
      ipcRenderer.invoke(Channel.GIT_LOG, payload) as Promise<GitLogResult>,
    gitCommitDetail: (payload: GitRefPayload) =>
      ipcRenderer.invoke(Channel.GIT_COMMIT_DETAIL, payload) as Promise<GitCommitDetailResult>,
    gitBranches: (payload: GitProjectPayload) =>
      ipcRenderer.invoke(Channel.GIT_BRANCHES, payload) as Promise<GitBranchListResult>,
    gitStashes: (payload: GitProjectPayload) =>
      ipcRenderer.invoke(Channel.GIT_STASHES, payload) as Promise<GitStashListResult>,
    gitStashShow: (payload: GitRefPayload) =>
      ipcRenderer.invoke(Channel.GIT_STASH_SHOW, payload) as Promise<GitStashShowResult>,
    gitSwitchBranch: (payload: GitBranchPayload) =>
      ipcRenderer.invoke(Channel.GIT_SWITCH_BRANCH, payload) as Promise<GitActionResult>,
    gitCreateBranch: (payload: GitBranchPayload) =>
      ipcRenderer.invoke(Channel.GIT_CREATE_BRANCH, payload) as Promise<GitActionResult>,
    gitTrackBranch: (payload: GitBranchPayload) =>
      ipcRenderer.invoke(Channel.GIT_TRACK_BRANCH, payload) as Promise<GitActionResult>,
    gitMergeBranch: (payload: GitBranchPayload) =>
      ipcRenderer.invoke(Channel.GIT_MERGE_BRANCH, payload) as Promise<GitActionResult>,
    gitDeleteBranch: (payload: GitBranchPayload) =>
      ipcRenderer.invoke(Channel.GIT_DELETE_BRANCH, payload) as Promise<GitActionResult>,
    gitForceDeleteBranch: (payload: GitBranchPayload) =>
      ipcRenderer.invoke(Channel.GIT_FORCE_DELETE_BRANCH, payload) as Promise<GitActionResult>,
    gitStashPush: (payload: GitStashPushPayload) =>
      ipcRenderer.invoke(Channel.GIT_STASH_PUSH, payload) as Promise<GitActionResult>,
    gitApplyStash: (payload: GitRefPayload) =>
      ipcRenderer.invoke(Channel.GIT_APPLY_STASH, payload) as Promise<GitActionResult>,
    gitDropStash: (payload: GitRefPayload) =>
      ipcRenderer.invoke(Channel.GIT_DROP_STASH, payload) as Promise<GitActionResult>,
  }
}
