import { useGitState, type GitStateHandle } from './useGitState'
import { useGitPanelActions, useTurnEndRefresh, type GitPanelActions } from './useGitActions'
import { useGitBulkActions, type GitBulkActions } from './useGitBulkActions'
import { useGitRefs } from './useGitRefs'
import { useGitRefActions } from './useGitRefActions'
import type { GitBranchMenu } from '../components/GitBranchChip'
import type { ToastApi } from './useToasts'

// App 이 쥐는 git 배선 한 묶음 — 상태 구독 · 화면 수준 행동 · 묶음 행동 · 브랜치 메뉴.
//
// 흩어져 있던 훅들을 여기로 모은 이유는 `useGitActions` 머리말과 같다: App.tsx 가
// 300줄 상한에 붙어 있다. 사이드바 브랜치 메뉴를 배선하면서 자리가 모자랐다.
//
// ⚠ **브랜치 목록은 소스 관리 탭이 자기 것을 따로 읽는다** (`ScmTab.tsx` 의 `useGitRefs`).
//   목록은 밀려오지 않으므로(`useGitRefs` 머리말) 한쪽에서 옮기면 다른 쪽 목록의
//   `current` 표시가 ⟳ 를 누를 때까지 옛것으로 남는다. 화면에 크게 뜨는 브랜치 **이름**은
//   `GitState` 가 밀어 주므로 양쪽 다 맞다 — 어긋나는 것은 메뉴 안의 표시뿐이다.

export interface AppGitHandle {
  git: GitStateHandle
  gitActions: GitPanelActions
  gitBulk: GitBulkActions
  /** 사이드바 브랜치 칩의 전환·생성 메뉴 */
  branchMenu: GitBranchMenu
}

export function useAppGit(
  projectId: string | null,
  toasts: ToastApi,
  /** 턴이 끝나는 순간을 알기 위해서만 쓴다 (참→거짓) */
  isStreaming: boolean,
): AppGitHandle {
  const git = useGitState(projectId, true)
  // 턴이 끝나면 git 을 다시 읽는다 (설계 §6) — 에이전트가 파일을 고쳤을 수 있다.
  // 스트리밍이 참→거짓으로 떨어지는 순간이 턴 종료다.
  useTurnEndRefresh(isStreaming, git.refresh)
  const gitActions = useGitPanelActions(git, toasts)
  const gitBulk = useGitBulkActions(projectId, toasts)

  const refs = useGitRefs(projectId)
  const refActions = useGitRefActions(projectId, refs, toasts)

  return {
    git,
    gitActions,
    gitBulk,
    branchMenu: {
      // 원격은 받아오기가 따로라 칩 메뉴에 넣지 않는다 (`GitBranchMenu` 주석)
      branches: refs.branches.filter((branch) => !branch.remote),
      busy: refActions.busy,
      onSwitch: refActions.onSwitch,
      onCreate: refActions.onCreate,
    },
  }
}
