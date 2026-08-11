import type { GitFileEntry } from '../../shared/git/gitState'
import { GitFileRow } from './GitFileRow'

// 변경 파일 묶음 하나 (스테이지됨 / 변경사항).
//
// `GitPanel` 의 로컬 컴포넌트였다. 사이드바와 소스 관리 탭이 같은 묶음을 그려서
// 밖으로 뺐다 — 두 곳에서 잘라내기 규칙이나 겹침 표시가 갈리면 안 된다.

/** 목록이 아주 길면 잘라 보여준다. 조용히 자르지 않고 몇 개가 빠졌는지 알린다. */
const MAX_ROWS = 200

export interface GitGroupAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

export interface GitGroupProps {
  title: string
  entries: GitFileEntry[]
  staged: boolean
  /** 양쪽 묶음에 다 있는 경로 (담아 둔 뒤 또 고친 것) */
  bothSides: Set<string>
  onOpenDiff: (path: string, staged: boolean) => void
  onToggle: (path: string, stage: boolean) => void
  onRevert: (path: string) => void
  /**
   * 묶음 전체에 거는 행동 (모두 담기 / 모두 취소).
   *
   * **주지 않으면 버튼을 그리지 않는다.** 아직 채널이 없는 행동(임시저장 등)을
   * 회색 버튼으로 미리 앉혀두지 않기 위한 자리다.
   */
  action?: GitGroupAction
}

export function GitGroup({ title, entries, staged, bothSides, action, ...row }: GitGroupProps) {
  if (entries.length === 0) return null

  const shown = entries.slice(0, MAX_ROWS)
  const hidden = entries.length - shown.length

  return (
    <section className="git-group">
      <h4 className="git-group__title">
        {title} <span className="git-group__count">{entries.length}</span>
        {action && (
          <button
            type="button"
            className="git-group__action"
            disabled={action.disabled === true}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
      </h4>
      {shown.map((entry) => (
        <GitFileRow
          key={`${staged ? 's' : 'u'}:${entry.path}`}
          entry={entry}
          staged={staged}
          onOpenDiff={row.onOpenDiff}
          onToggle={row.onToggle}
          onRevert={row.onRevert}
          {...(bothSides.has(entry.path) ? { alsoOnOtherSide: true } : {})}
        />
      ))}
      {hidden > 0 && <p className="git-group__more">외 {hidden}개</p>}
    </section>
  )
}
