import type { GitFileEntry, GitState } from '../../shared/git/gitState'
import { GitBranchBar } from './GitBranchBar'
import type { GitBranchMenu } from './GitBranchChip'
import { GitCommitBox } from './GitCommitBox'
import { GitGroup } from './GitGroup'
import '../styles/git.css'

// 소스 관리 패널.
//
// **여기 있는 버튼은 전부 눌린다.** 아직 채널이 없는 행동(임시저장 등)은 자리를
// 비워 둔다 — 눌리지 않는 버튼이 남으면 "이건 왜 안 되지" 하는 잡음이 생긴다.
// 그래서 묶음 액션도, 전체 화면 버튼도 콜백을 받았을 때만 그린다.

export interface GitPanelProps {
  state: GitState
  loading: boolean
  onRefresh: () => void
  /** 파일 이름을 누르면 본문 영역에 diff 탭으로 연다 (설계 §2) */
  onOpenDiff: (path: string, staged: boolean) => void
  onToggle: (path: string, stage: boolean) => void
  onRevert: (path: string) => void
  onPull: () => void
  onCommit: (message: string) => void
  onPush: () => void
  /** 변경사항을 전부 담는다. 주지 않으면 「모두 담기」를 그리지 않는다. */
  onStageAll?: () => void
  /** 인덱스를 통째로 비운다. 주지 않으면 「모두 취소」를 그리지 않는다. */
  onUnstageAll?: () => void
  /** 본문에 소스 관리 탭을 연다. 주지 않으면 「전체 화면에서 보기」를 그리지 않는다. */
  onOpenScm?: () => void
  /**
   * 브랜치 칩의 전환·생성 메뉴. 주지 않으면 칩에 캐럿이 없다 (`GitBranchChip` 머리말).
   *
   * 1단계에는 전환·생성 채널이 없어 안 줬는데, 3단계에서 채널이 생긴 뒤에도 안 주고 있었다
   * — 사이드바 칩을 눌러도 아무 일이 없었다 (QA D6). 그 자리를 아래 테스트가 잠근다.
   */
  branchMenu?: GitBranchMenu
}

export function GitPanel(props: GitPanelProps) {
  const { state, loading, onRefresh, onStageAll, onUnstageAll, onOpenScm } = props
  if (!state.isRepo) {
    // 메뉴 항목은 남긴다 (설계 §2) — 감추면 "왜 안 보이지" 하고 찾게 된다
    return <p className="git-empty">git 저장소가 아닙니다.</p>
  }
  if (state.error !== undefined) {
    return <p className="git-empty git-empty--error">{state.error}</p>
  }

  const bothSides = overlap(state.staged, state.unstaged)
  const row = { onOpenDiff: props.onOpenDiff, onToggle: props.onToggle, onRevert: props.onRevert }

  return (
    <div className="git-panel">
      <GitBranchBar
        state={state}
        busy={loading}
        onRefresh={onRefresh}
        onPull={props.onPull}
        {...(props.branchMenu ? { branchMenu: props.branchMenu } : {})}
      />

      {state.staged.length === 0 && state.unstaged.length === 0 ? (
        <p className="git-empty">변경된 파일이 없습니다.</p>
      ) : (
        <>
          <GitGroup
            title="스테이지됨"
            entries={state.staged}
            staged
            bothSides={bothSides}
            {...(onUnstageAll
              ? { action: { label: '모두 취소', onClick: onUnstageAll, disabled: loading } }
              : {})}
            {...row}
          />
          <GitGroup
            title="변경사항"
            entries={state.unstaged}
            staged={false}
            bothSides={bothSides}
            {...(onStageAll
              ? { action: { label: '모두 담기', onClick: onStageAll, disabled: loading } }
              : {})}
            {...row}
          />
        </>
      )}

      <GitCommitBox
        hasStaged={state.staged.length > 0}
        canPush={state.upstream === null ? state.ahead > 0 || state.branch !== null : state.ahead > 0}
        busy={loading}
        onCommit={props.onCommit}
        onPush={props.onPush}
      />

      {onOpenScm && (
        <button type="button" className="git-panel__full" onClick={onOpenScm}>
          전체 화면에서 보기 →
        </button>
      )}
    </div>
  )
}

/** 양쪽 묶음에 다 있는 경로 (담아 둔 뒤 또 고친 것) */
function overlap(staged: GitFileEntry[], unstaged: GitFileEntry[]): Set<string> {
  const left = new Set(staged.map((entry) => entry.path))
  return new Set(unstaged.map((entry) => entry.path).filter((path) => left.has(path)))
}
