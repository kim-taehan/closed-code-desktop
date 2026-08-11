import { useState } from 'react'
import type { GitFileEntry, GitState } from '../../shared/git/gitState'
import { GitGroup } from './GitGroup'
import { fuzzyMatch } from '../state/fuzzy'

// 변경사항 갈래의 왼쪽 — 고를 파일 목록.
//
// 줄과 묶음은 사이드바가 쓰는 `GitGroup`·`GitFileRow` **그대로**다. 두 화면이 같은
// 파일을 다르게 그리면 어느 쪽이 사실인지 알 수 없다.
//
// 파일 이름을 누르면 **탭을 열지 않고** 오른쪽 칸에 그린다 — `GitGroup` 의
// `onOpenDiff` 자리에 선택 알림을 끼운다 (그쪽은 "이 파일을 눌렀다" 만 알린다).

export interface ScmFileListProps {
  state: GitState
  loading: boolean
  /** 파일을 골랐을 때. 어느 묶음에서 눌렀는지가 diff 대상을 가른다. */
  onSelect: (path: string, staged: boolean) => void
  onToggle: (path: string, stage: boolean) => void
  onRevert: (path: string) => void
  /** 주지 않으면 묶음 머리에 버튼을 그리지 않는다 (`GitGroup` 규칙) */
  onStageAll?: () => void
  onUnstageAll?: () => void
}

export function ScmFileList(props: ScmFileListProps) {
  const { state, loading } = props
  const [query, setQuery] = useState('')

  const staged = filter(state.staged, query)
  const unstaged = filter(state.unstaged, query)
  const bothSides = overlap(state.staged, state.unstaged)
  const row = { onOpenDiff: props.onSelect, onToggle: props.onToggle, onRevert: props.onRevert }

  return (
    <div className="scm-files">
      <div className="scm-filter">
        <input
          className="scm-filter__input"
          type="text"
          value={query}
          placeholder="파일 이름으로 거르기"
          aria-label="파일 이름으로 거르기"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="scm-files__body">
        {/* 사이드바와 같은 문구를 쓴다 (GitPanel) */}
        {state.staged.length === 0 && state.unstaged.length === 0 ? (
          <p className="git-empty">변경된 파일이 없습니다.</p>
        ) : staged.length === 0 && unstaged.length === 0 ? (
          <p className="git-empty">거른 조건에 맞는 파일이 없습니다.</p>
        ) : (
          <>
            <GitGroup
              title="스테이지됨"
              entries={staged}
              staged
              bothSides={bothSides}
              {...(props.onUnstageAll
                ? { action: { label: '모두 취소', onClick: props.onUnstageAll, disabled: loading } }
                : {})}
              {...row}
            />
            <GitGroup
              title="변경사항"
              entries={unstaged}
              staged={false}
              bothSides={bothSides}
              {...(props.onStageAll
                ? { action: { label: '모두 담기', onClick: props.onStageAll, disabled: loading } }
                : {})}
              {...row}
            />
          </>
        )}
      </div>
    </div>
  )
}

/**
 * 이름으로 거른다 (`fuzzy.ts` 재사용 — 빠른 열기와 같은 규칙).
 *
 * **점수로 다시 줄 세우지 않는다.** git 이 준 순서(경로 사전순)를 그대로 둬야
 * 글자를 한 자 칠 때마다 남은 줄이 위아래로 튀지 않는다.
 */
function filter(entries: GitFileEntry[], query: string): GitFileEntry[] {
  if (query.trim() === '') return entries
  return entries.filter((entry) => fuzzyMatch(query, entry.path) !== null)
}

/** 양쪽 묶음에 다 있는 경로 (담아 둔 뒤 또 고친 것) — `GitPanel` 과 같은 규칙 */
function overlap(staged: GitFileEntry[], unstaged: GitFileEntry[]): Set<string> {
  const left = new Set(staged.map((entry) => entry.path))
  return new Set(unstaged.map((entry) => entry.path).filter((path) => left.has(path)))
}
