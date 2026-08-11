import type { GitState } from '../../shared/git/gitState'
import { GitBranchChip, type GitBranchMenu } from './GitBranchChip'

// 소스 관리 패널 맨 윗줄 — 브랜치와 원격과의 차이.
//
// **↑↓ 는 마지막으로 받아온 원격 기준이다.** ⟳ 를 누를 때만 원격에 물어본다 (설계 §6).

export interface GitBranchBarProps {
  state: GitState
  busy: boolean
  onRefresh: () => void
  /** 원격이 앞설 때(behind>0) 당겨오기 */
  onPull: () => void
  /**
   * 브랜치 칩의 전환·생성 메뉴. **주지 않으면 캐럿을 그리지 않는다.**
   *
   * 사이드바(`GitPanel`←`useAppGit`)와 소스 관리 탭(`ScmTab`)이 각각 자기 목록으로 준다.
   */
  branchMenu?: GitBranchMenu
}

export function GitBranchBar({ state, busy, onRefresh, onPull, branchMenu }: GitBranchBarProps) {
  return (
    <div className="git-bar">
      <GitBranchChip branch={state.branch} {...(branchMenu ? { menu: branchMenu } : {})} />

      {state.upstream === null ? (
        // 업스트림이 없으면 비교 대상이 없다. 화살표 자리에 이유를 적는다.
        <span className="git-bar__note">origin 없음</span>
      ) : state.fetchFailed ? (
        // fetch 가 실패해 ahead/behind 를 믿을 수 없다 (사내망 밖)
        <span className="git-bar__note">확인 안 됨</span>
      ) : (
        // 둘 다 0이면 그리지 않는다 — 늘 붙어 있으면 눈이 무시하게 된다
        <span className="git-bar__counts">
          {state.ahead > 0 && <span className="git-bar__ahead">↑{state.ahead}</span>}
          {state.behind > 0 && <span className="git-bar__behind">↓{state.behind}</span>}
        </span>
      )}

      {/* 원격이 앞서면 푸시가 거절된다 — 먼저 당겨오라고 버튼을 내놓는다 */}
      {state.behind > 0 && (
        <button type="button" className="git-bar__pull" onClick={onPull} disabled={busy}>
          당겨오기
        </button>
      )}

      <button
        type="button"
        className="git-bar__refresh"
        onClick={onRefresh}
        disabled={busy}
        title="다시 읽기"
      >
        ⟳
      </button>
    </div>
  )
}
