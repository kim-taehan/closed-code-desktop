import type { GitFileEntry } from '../../shared/git/gitState'
import type { ScmDiffHandle } from '../state/useScmDiff'
import { FileDiffView } from './FileDiffView'

// 변경사항 갈래의 오른쪽 — 고른 파일의 변경 내용.
//
// **`FileDiffView` 를 그대로 쓴다.** 그쪽은 행(`DiffRow[]`)만 받고 크기도 스크롤도
// 소유하지 않는다 — 새 diff 뷰어를 만들 이유가 없다. 스크롤은 이 칸이 쥔다.
//
// 덩어리마다 따로 그린다. 머리(`@@ …`)는 **원문 그대로** 보여준다 — 되만든 문자열을
// 보여주면 화면과 main 이 다른 것을 말하게 된다 (`diffHunks.ts` 머리말).

export interface ScmDiffPaneProps {
  /** 고른 파일 경로. null 이면 안내만 */
  path: string | null
  /** 그 파일의 목록 항목. 묶음에서 사라졌으면 null (행동을 그리지 않는다) */
  entry: GitFileEntry | null
  /** 어느 묶음에서 골랐는가. 담긴 쪽 diff 에는 덩어리 행동이 없다. */
  staged: boolean
  diff: ScmDiffHandle
  onToggle: (path: string, stage: boolean) => void
  /** 파일 통째로 되돌리기. 되돌릴 수 없어 부르는 쪽이 확인을 받는다. */
  onRevert: (path: string) => void
}

export function ScmDiffPane(props: ScmDiffPaneProps) {
  const { path, entry, staged } = props
  if (path === null) {
    return <p className="git-empty">왼쪽에서 파일을 고르면 변경 내용이 보입니다.</p>
  }

  const cut = path.lastIndexOf('/') + 1
  const conflicted = entry?.status === 'conflicted'
  // 추적 안 되는 파일에는 되돌릴 이전 내용이 없다 (`GitFileRow` 와 같은 규칙).
  const canRevert = entry !== null && !conflicted && entry.status !== 'untracked'

  return (
    <div className="scm-diff">
      <div className="scm-diff__head">
        <span className="scm-diff__path" title={path}>
          {cut > 0 && <span className="git-row__dir">{path.slice(0, cut)}</span>}
          {path.slice(cut)}
        </span>
        {/* 충돌은 담을 수 없는 상태다 — 해결은 터미널에서 (`GitFileRow` 와 같다) */}
        {entry !== null && !conflicted && (
          <button
            type="button"
            className="scm-btn"
            onClick={() => props.onToggle(path, !staged)}
          >
            {staged ? '담기 취소' : '파일 담기'}
          </button>
        )}
        {canRevert && (
          <button type="button" className="scm-btn scm-btn--ghost" onClick={() => props.onRevert(path)}>
            되돌리기
          </button>
        )}
      </div>

      <div className="scm-diff__body">
        <Body {...props} />
      </div>
    </div>
  )
}

function Body({ diff, staged }: ScmDiffPaneProps) {
  if (diff.error !== null) return <p className="git-empty git-empty--error">{diff.error}</p>
  // 추적 안 되는 파일은 비교 대상이 없어 덩어리가 없다. 내용을 통째로 보여준다.
  if (diff.untracked) return <FileDiffView rows={diff.rows} />
  if (diff.hunks.length === 0) {
    return <p className="git-empty">{diff.loading ? '읽는 중…' : '변경 내용이 없습니다.'}</p>
  }

  return (
    <>
      {diff.hunks.map((hunk, index) => (
        <div className="scm-hunk" key={`${index}:${hunk.header}`}>
          <div className="scm-hunk__head">
            <span className="scm-hunk__title">{hunk.header}</span>
            {/* 담긴 쪽에는 담을 것이 없다 — 눌리지 않는 버튼을 남기지 않는다 */}
            {!staged && (
              <span className="scm-hunk__actions">
                <button type="button" className="scm-btn" onClick={() => diff.onStageHunk(index)}>
                  이 덩어리 담기
                </button>
                <button
                  type="button"
                  className="scm-btn scm-btn--ghost"
                  onClick={() => diff.onRevertHunk(index)}
                >
                  되돌리기
                </button>
              </span>
            )}
          </div>
          <FileDiffView rows={hunk.rows} />
        </div>
      ))}
    </>
  )
}
