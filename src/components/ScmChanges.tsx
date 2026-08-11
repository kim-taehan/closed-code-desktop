import { useState } from 'react'
import type { GitFileEntry, GitState } from '../../shared/git/gitState'
import type { ScmViewHandle } from '../state/useScmView'
import type { GitBulkActions } from '../state/useGitBulkActions'
import type { ToastApi } from '../state/useToasts'
import { useScmDiff } from '../state/useScmDiff'
import { useScmCommit } from '../state/useScmCommit'
import { ScmFileList } from './ScmFileList'
import { ScmDiffPane } from './ScmDiffPane'
import { ScmCommitBar } from './ScmCommitBar'

// 「변경사항」 갈래 — 고를 것(왼쪽) · 볼 것(오른쪽) · 쓸 것(아래)을 한 화면에 둔다.
//
// **파일을 골라도 탭이 늘지 않는다.** 이 갈래의 존재 이유다 — `useOpenFiles` 를
// 아예 받지 않아서, 여기서 탭을 만들 방법이 없다. diff 는 `useScmDiff` 가 직접 읽는다.

export interface ScmChangesProps {
  state: GitState
  loading: boolean
  view: ScmViewHandle
  projectId: string | null
  toasts: ToastApi
  /** 모두 담기 / 모두 취소 (사이드바와 같은 훅을 쓴다) */
  bulk: GitBulkActions
  onToggle: (path: string, stage: boolean) => void
  onRevert: (path: string) => void
  onCommit: (message: string) => void
  onPush: () => void
}

/** `ScmTab` 이 채워 주는 것(상태·갈래)을 뺀 나머지 — 위에서 내려오는 배선 */
export type ScmChangesWiring = Omit<ScmChangesProps, 'state' | 'loading' | 'view'>

export function ScmChanges(props: ScmChangesProps) {
  const { state, view } = props
  // 어느 묶음에서 골랐는지. 고른 **경로**는 탭을 떠나도 남아야 해 `useScmView` 가 쥐지만,
  // 묶음은 화면 안의 순간 상태라 여기 둔다. 같은 파일이 양쪽에 있으면 이것이 갈라 준다.
  const [staged, setStaged] = useState(false)

  const diff = useScmDiff(props.projectId, view.file, staged, props.toasts)
  const menu = useScmCommit(props.projectId, props.toasts, props.onPush)

  return (
    <div className="scm-changes">
      <div className="scm-split">
        <ScmFileList
          state={state}
          loading={props.loading}
          onSelect={(path, side) => {
            view.selectFile(path)
            setStaged(side)
          }}
          onToggle={props.onToggle}
          onRevert={props.onRevert}
          onStageAll={props.bulk.onStageAll}
          onUnstageAll={props.bulk.onUnstageAll}
        />
        <ScmDiffPane
          path={view.file}
          entry={findEntry(state, view.file, staged)}
          staged={staged}
          diff={diff}
          onToggle={props.onToggle}
          onRevert={props.onRevert}
        />
      </div>

      <ScmCommitBar
        hasStaged={state.staged.length > 0}
        stagedCount={state.staged.length}
        // 사이드바(`GitPanel`)와 같은 판정을 쓴다 — 같은 저장소가 자리마다 다르게 보이면 안 된다
        canPush={state.upstream === null ? state.ahead > 0 || state.branch !== null : state.ahead > 0}
        busy={props.loading}
        onCommit={props.onCommit}
        onPush={props.onPush}
        menu={menu}
      />
    </div>
  )
}

/**
 * 고른 파일의 목록 항목. **고른 묶음에서만 찾는다.**
 *
 * 반대쪽으로 옮겨 갔으면(예: 통째로 담았으면) null 이다 — 그때는 오른쪽 칸이
 * 행동 버튼 없이 "변경 내용이 없습니다" 를 보여준다. 다른 묶음에서 몰래 찾아
 * 그리면 화면이 왼쪽 목록과 어긋난다.
 */
function findEntry(state: GitState, path: string | null, staged: boolean): GitFileEntry | null {
  if (path === null) return null
  const entries = staged ? state.staged : state.unstaged
  return entries.find((entry) => entry.path === path) ?? null
}
