import type { GitCommitSummary } from '../../shared/git/gitCommit'
import type { ScmViewHandle } from '../state/useScmView'
import { useGitLog } from '../state/useGitLog'
import { formatGitWhen } from '../utils/gitWhen'
import { ScmCommitDetail } from './ScmCommitDetail'

// 「히스토리」 갈래 — 커밋 목록(왼쪽)과 고른 커밋(오른쪽). 변경사항 갈래와 같은 골격이다.
//
// **레일은 세로선 + 점까지다.** 병합 곡선·레인 배치는 그리지 않는다 — 그러려면 부모
// 관계를 따로 읽어 레인을 배치해야 하는데 지금 오는 데이터에 부모가 없다.
//
// 가상 스크롤을 들이지 않는다. 이 레포의 관행은 **잘라내기 + 더 보기**다
// (`FileDiffView MAX_ROWS`·`GitPanel MAX_ROWS`) — 한 쪽 100개씩 이어 붙인다.

export interface ScmHistoryProps {
  projectId: string | null
  /** 고른 커밋은 탭을 떠나도 남아야 해 위(`useScmView`)가 쥔다 */
  view: ScmViewHandle
}

export function ScmHistory({ projectId, view }: ScmHistoryProps) {
  const log = useGitLog(projectId)

  return (
    <div className="scm-history">
      <div className="scm-commits">
        <div className="scm-commits__body">
          {log.error !== null ? (
            <p className="git-empty git-empty--error">{log.error}</p>
          ) : log.commits.length === 0 ? (
            // 커밋이 하나도 없는 저장소는 **오류가 아니다** (`useGitLog` 주석)
            <p className="git-empty">{log.loading ? '읽는 중…' : '아직 커밋이 없습니다.'}</p>
          ) : (
            log.commits.map((commit) => (
              <CommitRow
                key={commit.hash}
                commit={commit}
                selected={commit.hash === view.commit}
                onSelect={() => view.selectCommit(commit.hash)}
              />
            ))
          )}
        </div>

        {/* 다음 쪽이 있을 때만 그린다 — 끝까지 읽고도 남아 있으면 눌러도 아무 일이 없다 */}
        {log.hasMore && (
          <button
            type="button"
            className="scm-more"
            onClick={log.loadMore}
            disabled={log.loading}
          >
            {log.loading ? '읽는 중…' : '더 보기'}
          </button>
        )}
      </div>

      <div className="scm-detail-pane">
        <ScmCommitDetail projectId={projectId} hash={view.commit} />
      </div>
    </div>
  )
}

function CommitRow({
  commit,
  selected,
  onSelect,
}: {
  commit: GitCommitSummary
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`scm-commit-row${selected ? ' scm-commit-row--on' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="scm-rail" aria-hidden="true">
        <i className="scm-rail__dot" />
      </span>
      <span className="scm-commit-row__body">
        <span className="scm-commit-row__msg">
          {commit.refs.map((ref) => (
            <RefBadge key={ref} label={ref} />
          ))}
          {commit.subject}
        </span>
        <span className="scm-commit-row__sub">
          {`${commit.shortHash} · ${commit.author} · ${formatGitWhen(commit.date)}`}
        </span>
      </span>
    </button>
  )
}

/**
 * `%D` 가 준 라벨 하나 (`HEAD -> main` · `origin/main` · `tag: v1.0`).
 *
 * **git 이 준 글자를 그대로 보인다.** `HEAD -> main` 을 `HEAD` 로 줄이면 어느
 * 브랜치가 거기 있는지가 사라진다. 종류만 색으로 가른다.
 */
function RefBadge({ label }: { label: string }) {
  const kind = label.startsWith('HEAD')
    ? 'head'
    : label.startsWith('tag:')
      ? 'tag'
      : label.includes('/')
        ? 'remote'
        : 'local'

  return <span className={`scm-badge scm-badge--${kind}`}>{label}</span>
}
