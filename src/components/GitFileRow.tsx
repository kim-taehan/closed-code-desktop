import type { GitFileEntry } from '../../shared/git/gitState'
import { STATUS_LETTER } from '../state/gitBadge'

// 변경된 파일 한 줄.
//
// **체크 상태를 따로 들고 있지 않는다** (설계 §3). 화면의 체크는 언제나 실제 인덱스다.
// 누르면 IPC 를 부르고, 밀려온 새 상태로 다시 그린다. 그래서 보이는 것이 곧 사실이다.
//
// 상태 글자는 `gitBadge.STATUS_LETTER` 를 쓴다 — 한동안 같은 표를 여기에도 따로
// 들고 있었다. 패널과 파일 트리가 같은 글자를 써야 두 곳이 같은 것을 뜻한다.

export interface GitFileRowProps {
  entry: GitFileEntry
  staged: boolean
  /** 같은 파일이 반대쪽 묶음에도 있는지. 그때만 이유를 단다. */
  alsoOnOtherSide?: boolean
  onOpenDiff: (path: string, staged: boolean) => void
  /** 체크 토글. 담기(true)거나 빼기(false)다. */
  onToggle: (path: string, stage: boolean) => void
  /** 되돌리기. 되돌릴 수 없는 행동이라 부르는 쪽이 확인을 받은 뒤에만 부른다. */
  onRevert: (path: string) => void
}

export function GitFileRow({
  entry,
  staged,
  alsoOnOtherSide,
  onOpenDiff,
  onToggle,
  onRevert,
}: GitFileRowProps) {
  // 충돌은 담을 수 없는 상태다. 되돌리기도 위험해 막는다 — 해결은 터미널에서.
  const conflicted = entry.status === 'conflicted'
  // 추적 안 되는 파일에는 되돌릴 이전 내용이 없다. ↩ 는 삭제가 되므로 두지 않는다 (설계 §4).
  const canRevert = !conflicted && entry.status !== 'untracked'
  const cut = entry.path.lastIndexOf('/') + 1

  return (
    <div className="git-row" title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}>
      <input
        type="checkbox"
        className="git-row__check"
        checked={staged}
        disabled={conflicted}
        onChange={() => onToggle(entry.path, !staged)}
        aria-label={entry.path}
      />
      <span className={`git-row__letter git-row__letter--${entry.status}`}>
        {STATUS_LETTER[entry.status]}
      </span>
      {/* 폴더는 흐리게, 파일 이름은 그대로 — 좁은 칸에서 눈이 파일 이름에 먼저 닿아야 한다.
          두 조각으로 나눠도 잘라내기(rtl)는 그대로다. bidi 는 요소 경계를 보지 않는다. */}
      <button type="button" className="git-row__path" onClick={() => onOpenDiff(entry.path, staged)}>
        {cut > 0 && <span className="git-row__dir">{entry.path.slice(0, cut)}</span>}
        {entry.path.slice(cut)}
      </button>

      {/* 한 파일이 양쪽에 나오는 것은 git 의 사실이다. 억지로 한쪽에 몰지 않고 이유를 적는다. */}
      {alsoOnOtherSide && (
        <span className="git-row__note">{staged ? '담은 뒤 또 고침' : '일부만 담김'}</span>
      )}

      {conflicted ? <ConflictTag count={entry.conflictCount} /> : <Stat entry={entry} />}

      {canRevert && (
        <button
          type="button"
          className="git-row__revert"
          title="되돌리기"
          onClick={() => onRevert(entry.path)}
        >
          ↩
        </button>
      )}
    </div>
  )
}

/**
 * 바뀐 줄 수.
 *
 * **없음(undefined)과 0 은 다른 뜻이다** (`gitState.GitFileEntry` 주석). 없음은
 * "모름" — 바이너리에는 줄 수라는 게 없다. 뭉개서 `+0 −0` 을 그리면 바이너리가
 * "아무것도 안 바뀐 파일"처럼 보인다. 0 도 그리지 않는다 — ↑↓ 와 같은 규칙이다.
 */
function Stat({ entry }: { entry: GitFileEntry }) {
  const plus = entry.insertions !== undefined && entry.insertions > 0
  const minus = entry.deletions !== undefined && entry.deletions > 0
  if (!plus && !minus) return null

  return (
    <span className="git-row__stat">
      {plus && <span className="git-row__stat-plus">+{entry.insertions}</span>}
      {minus && <span className="git-row__stat-minus">−{entry.deletions}</span>}
    </span>
  )
}

/** 충돌 지점 개수. 세지 못했으면 개수 없이 '충돌' 만 — 0곳이라고 지어내지 않는다. */
function ConflictTag({ count }: { count?: number }) {
  return (
    <span className="git-row__conflict">{count === undefined ? '충돌' : `충돌 ${count}곳`}</span>
  )
}
