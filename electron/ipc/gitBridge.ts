import { ipcMain, type BrowserWindow } from 'electron'
import {
  Channel,
  type GitActionResult,
  type GitCommitPayload,
  type GitDiffPayload,
  type GitDiffResultPayload,
  type GitHunkPayload,
  type GitPathPayload,
  type GitProjectPayload,
  type GitPushPayload,
  type GitStatePayload,
  type ProjectScoped,
} from '../../shared/ipc/channels'
import { EMPTY_GIT_STATE, type GitState } from '../../shared/git/gitState'
import type { ProjectRegistry } from '../projects/projectRegistry'
import { enrichGitState, readEnrichedGitState } from '../git/gitEnrich'
import { readGitDiff } from '../git/gitDiff'
import {
  stage,
  unstage,
  revert,
  commit,
  stageAll,
  unstageAll,
  amend,
  undoCommit,
} from '../git/gitActions'
import { push, pull, refreshWithFetch } from '../git/gitRemote'
import { stageHunk, revertHunk } from '../git/gitHunk'
import { GIT_HISTORY_CHANNELS, registerGitHistoryHandlers } from './gitHistoryHandlers'

// 소스 관리 채널.
//
// `projectBridge` 를 키우지 않고 새 파일로 간다 — 그쪽은 242줄이고, git 은
// 프로젝트 파일 시스템이 아니라 저장소를 다루는 별개 관심사다.
//
// **열린 프로젝트만 조회한다.** 닫은 프로젝트의 저장소를 읽을 이유가 없고,
// 이 경계가 설계 §6 의 "패널을 열지 않은 프로젝트에서는 돌리지 않는다" 와 같다.

const HANDLED_CHANNELS = [
  Channel.GIT_STATE,
  Channel.GIT_FILE_DIFF,
  Channel.GIT_STAGE,
  Channel.GIT_UNSTAGE,
  Channel.GIT_REVERT,
  Channel.GIT_STAGE_HUNK,
  Channel.GIT_REVERT_HUNK,
  Channel.GIT_COMMIT,
  Channel.GIT_PUSH,
  Channel.GIT_PULL,
  Channel.GIT_STAGE_ALL,
  Channel.GIT_UNSTAGE_ALL,
  Channel.GIT_AMEND,
  Channel.GIT_UNDO_COMMIT,
  Channel.GIT_REFRESH,
  // 히스토리·브랜치·임시저장은 gitHistoryHandlers 가 등록하지만 **해제는 여기가 쥔다**
  ...GIT_HISTORY_CHANNELS,
]

export class GitBridge {
  constructor(
    private readonly window: BrowserWindow,
    private readonly registry: ProjectRegistry,
  ) {}

  register(): void {
    ipcMain.handle(
      Channel.GIT_STATE,
      async (_event, payload: GitProjectPayload): Promise<GitStatePayload> => ({
        state: await this.read(payload.projectId),
      }),
    )

    ipcMain.handle(
      Channel.GIT_FILE_DIFF,
      async (_event, payload: GitDiffPayload): Promise<GitDiffResultPayload> => {
        const root = this.rootOf(payload.projectId)
        if (root === null) return { ok: false, diff: '', reason: '열려 있지 않은 프로젝트입니다' }
        return readGitDiff(root, payload.path, payload.staged)
      },
    )

    this.handleAction(Channel.GIT_STAGE, stage)
    this.handleAction(Channel.GIT_UNSTAGE, unstage)
    this.handleAction(Channel.GIT_REVERT, revert)

    // 덩어리(hunk) 단위. 위 셋과 같은 결이지만 경로 하나로 부족해 틀을 안 쓴다 —
    // `hunkIndex`·`hunkText` 를 **손대지 않고 그대로** 넘긴다. 여기서 trim 하거나
    // 다시 조립하면 main 의 원문 대조(`gitHunk.assemble`)가 매번 어긋나 전부 거절된다.
    //
    // ⚠ 담기가 성공하면 그 덩어리가 diff 에서 빠져 **뒤 덩어리의 인덱스가 밀린다.**
    // 뒤이어 나가는 `git:statePush` 가 화면을 다시 그리게 하고, 화면은 그때
    // diff 를 새로 받아야 한다. 옛 인덱스로 다시 부르면 원문 대조가 잡아 거절한다.
    ipcMain.handle(Channel.GIT_STAGE_HUNK, (_e, p: GitHunkPayload) =>
      this.afterAction(p.projectId, (root) => stageHunk(root, p.path, p.hunkIndex, p.hunkText)),
    )
    // ⚠ **되돌릴 수 없다.** 확인은 부르는 쪽(`useGitActions`)이 받는다 — `GIT_REVERT` 와 같다.
    ipcMain.handle(Channel.GIT_REVERT_HUNK, (_e, p: GitHunkPayload) =>
      this.afterAction(p.projectId, (root) => revertHunk(root, p.path, p.hunkIndex, p.hunkText)),
    )

    ipcMain.handle(Channel.GIT_COMMIT, (_e, p: GitCommitPayload) =>
      this.afterAction(p.projectId, (root) => commit(root, p.message)),
    )
    ipcMain.handle(Channel.GIT_PUSH, (_e, p: GitPushPayload) =>
      this.afterAction(p.projectId, (root) => push(root, p.setUpstream ?? false)),
    )
    ipcMain.handle(Channel.GIT_PULL, (_e, p: GitProjectPayload) =>
      this.afterAction(p.projectId, (root) => pull(root)),
    )

    // 묶음 행동. 경로를 받지 않는다는 것 말고는 위 셋과 같은 결이다.
    ipcMain.handle(Channel.GIT_STAGE_ALL, (_e, p: GitProjectPayload) =>
      this.afterAction(p.projectId, (root) => stageAll(root)),
    )
    ipcMain.handle(Channel.GIT_UNSTAGE_ALL, (_e, p: GitProjectPayload) =>
      this.afterAction(p.projectId, (root) => unstageAll(root)),
    )
    ipcMain.handle(Channel.GIT_AMEND, (_e, p: GitCommitPayload) =>
      this.afterAction(p.projectId, (root) => amend(root, p.message)),
    )
    ipcMain.handle(Channel.GIT_UNDO_COMMIT, (_e, p: GitProjectPayload) =>
      this.afterAction(p.projectId, (root) => undoCommit(root)),
    )

    // ⟳ 는 여기서만 fetch 를 돈다. 새 상태를 밀어주고 값은 반환하지 않는다.
    // `refreshWithFetch` 가 읽은 상태를 그대로 넘겨 수치를 얹는다 — 다시 읽으면
    // 두 시점이 섞이고 `fetchFailed` 를 잃는다.
    ipcMain.handle(Channel.GIT_REFRESH, async (_e, p: GitProjectPayload) => {
      const root = this.rootOf(p.projectId)
      if (root === null) return
      this.push(p.projectId, await enrichGitState(root, await refreshWithFetch(root)))
    })

    // 히스토리·브랜치·임시저장. 등록만 넘기고 해제는 HANDLED_CHANNELS 가 쥔다.
    registerGitHistoryHandlers({
      rootOf: (projectId) => this.rootOf(projectId),
      afterAction: (projectId, act) => this.afterAction(projectId, act),
    })
  }

  /** 행동을 돌리고 새 상태를 밀어준다. 실패해도 민다 — 화면을 사실과 맞춰 둔다. */
  private async afterAction(
    projectId: string,
    act: (root: string) => Promise<GitActionResult>,
  ): Promise<GitActionResult> {
    const root = this.rootOf(projectId)
    if (root === null) return { ok: false, message: '열려 있지 않은 프로젝트입니다' }

    const result = await act(root)
    this.push(projectId, await readEnrichedGitState(root))
    return result
  }

  /**
   * 경로 하나를 바꾸는 행동을 등록한다. 셋이 형태가 같아 한 틀로 묶는다.
   *
   * 행동 뒤에 **새 상태를 밀어준다** — 화면이 스스로 다시 묻지 않아도
   * 체크·되돌리기 결과가 바로 반영된다.
   */
  private handleAction(
    channel: string,
    act: (root: string, path: string) => Promise<GitActionResult>,
  ): void {
    ipcMain.handle(channel, async (_event, payload: GitPathPayload): Promise<GitActionResult> => {
      const root = this.rootOf(payload.projectId)
      if (root === null) return { ok: false, message: '열려 있지 않은 프로젝트입니다' }

      const result = await act(root, payload.path)
      // 실패해도 새 상태를 민다 — 아무것도 안 바뀌었어도 화면과 맞춰 둔다
      this.push(payload.projectId, await readEnrichedGitState(root))
      return result
    })
  }

  dispose(): void {
    for (const channel of HANDLED_CHANNELS) ipcMain.removeHandler(channel)
  }

  /** 상태가 바뀌었음을 화면에 알린다. 프로젝트 겉봉을 씌운다 — 탭마다 저장소가 다르다. */
  push(projectId: string, state: GitState): void {
    if (this.window.isDestroyed()) return
    const scoped: ProjectScoped<GitStatePayload> = { projectId, payload: { state } }
    this.window.webContents.send(Channel.GIT_STATE_PUSH, scoped)
  }

  private async read(projectId: string): Promise<GitState> {
    const root = this.rootOf(projectId)
    // 닫힌·모르는 프로젝트는 저장소가 아닌 것과 같게 답한다.
    // 여기서 예외를 던지면 화면이 무엇을 그릴지 알 수 없다.
    if (root === null) return { ...EMPTY_GIT_STATE }
    return readEnrichedGitState(root)
  }

  private rootOf(projectId: string): string | null {
    const project = this.registry.openProjects.find((entry) => entry.id === projectId)
    return project?.root ?? null
  }
}
