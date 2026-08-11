import type { GitFileChange } from '../../shared/git/gitCommit'
import { splitDiffHunks, type DiffHunk } from '../state/diffHunks'
import { useGitCommitDetail } from '../state/useGitLog'
import { formatGitWhen } from '../utils/gitWhen'
import { FileDiffView } from './FileDiffView'

// 히스토리 갈래의 오른쪽 — 고른 커밋 하나.
//
// **행동 버튼이 없다.** 목업에는 「이 커밋 되돌리기」·「이 시점 파일 열기」·「여기서
// 브랜치 만들기」가 있지만 그 채널이 없다 (`gitCreateBranch` 는 지금 HEAD 에서만
// 뜬다). 없는 기능의 버튼을 그리지 않는다.
//
// diff 는 `FileDiffView` 를 그대로 쓴다 — 새 뷰어를 만들지 않는다 (`ScmDiffPane` 과 같다).

export interface ScmCommitDetailProps {
  projectId: string | null
  /** 고른 커밋의 40자 해시. null 이면 안내만 */
  hash: string | null
}

export function ScmCommitDetail({ projectId, hash }: ScmCommitDetailProps) {
  const { detail, loading, error } = useGitCommitDetail(projectId, hash)

  if (hash === null) {
    return <p className="git-empty">왼쪽에서 커밋을 고르면 내용이 보입니다.</p>
  }
  if (error !== null) return <p className="git-empty git-empty--error">{error}</p>
  if (detail === null) {
    return <p className="git-empty">{loading ? '읽는 중…' : '커밋을 읽지 못했습니다.'}</p>
  }

  const { commit } = detail

  return (
    <div className="scm-detail">
      <div className="scm-detail__head">
        <h3 className="scm-detail__subject">{commit.subject}</h3>
        <p className="scm-detail__meta">
          <span className="scm-detail__hash">{commit.shortHash}</span>
          {` · ${commit.author} · ${formatGitWhen(commit.date)}`}
        </p>
      </div>

      <div className="scm-detail__files">
        <div className="git-group__title">
          바꾼 파일 <span className="git-group__count">{detail.files.length}</span>
        </div>
        {detail.files.map((file) => (
          <FileRow key={file.path} file={file} />
        ))}
      </div>

      {/* 🔴 잘렸으면 반드시 말한다. 감추면 "이 커밋은 여기까지 바꿨다" 로 잘못 읽힌다
          (`gitCommit.GitCommitDetail.truncated` 주석). */}
      {detail.truncated && (
        <p className="scm-detail__cut">
          변경 내용이 100KB 에서 잘렸습니다. 아래는 일부입니다 — 전부 보려면 터미널에서{' '}
          <code>git show {commit.shortHash}</code> 를 쓰세요.
        </p>
      )}

      {splitByFile(detail.diff).map((file) =>
        file.hunks.map((hunk, index) => (
          <div className="scm-hunk" key={`${file.path}:${index}:${hunk.header}`}>
            <div className="scm-hunk__head">
              <span className="scm-hunk__title">
                {file.path} {hunk.header}
              </span>
            </div>
            <FileDiffView rows={hunk.rows} />
          </div>
        )),
      )}
    </div>
  )
}

/**
 * 커밋이 건드린 파일 한 줄.
 *
 * `GitFileRow` 를 쓰지 않는다 — 그쪽은 담기 체크박스·되돌리기가 달린 **작업트리**
 * 파일이고, 여기는 이미 지나간 커밋이라 담을 것도 되돌릴 것도 없다. 대신 같은
 * css 를 써서 두 목록이 같은 모습으로 보이게 한다.
 */
function FileRow({ file }: { file: GitFileChange }) {
  const cut = file.path.lastIndexOf('/') + 1
  const title = file.oldPath === undefined ? file.path : `${file.oldPath} → ${file.path}`

  return (
    <div className="git-row" title={title}>
      <span className="git-row__path git-row__path--plain">
        {cut > 0 && <span className="git-row__dir">{file.path.slice(0, cut)}</span>}
        {file.path.slice(cut)}
      </span>
      {/* 없음(undefined)과 0 은 다른 뜻이다 — 없음은 바이너리다 (`GitFileChange` 주석) */}
      {file.insertions === undefined && file.deletions === undefined ? (
        <span className="git-row__note">바이너리</span>
      ) : (
        <span className="git-row__stat">
          {file.insertions !== undefined && file.insertions > 0 && (
            <span className="git-row__stat-plus">+{file.insertions}</span>
          )}
          {file.deletions !== undefined && file.deletions > 0 && (
            <span className="git-row__stat-minus">−{file.deletions}</span>
          )}
        </span>
      )}
    </div>
  )
}

interface FileDiff {
  path: string
  hunks: DiffHunk[]
}

/**
 * 커밋 diff 는 **파일 여러 개를 이어 붙인 것**이다. `diff --git` 줄을 경계로 갈라
 * 파일마다 `splitDiffHunks` 에 넘긴다 — 덩어리 가르는 규칙은 그쪽 하나만 둔다
 * (두 벌이 되면 화면과 main 이 다른 덩어리를 가리키게 된다).
 *
 * 파일 이름을 덩어리 머리에 붙이려고 이렇게 한다. `@@` 줄에는 파일 이름이 없어서,
 * 안 붙이면 여러 파일을 바꾼 커밋에서 어느 파일의 변경인지 알 수 없다.
 */
function splitByFile(text: string): FileDiff[] {
  const files: { path: string; lines: string[] }[] = []

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      files.push({ path: pathOfHeader(line), lines: [] })
      continue
    }
    // 첫 `diff --git` 앞에는 아무것도 없다 (git 이 그 줄부터 낸다)
    files[files.length - 1]?.lines.push(line)
  }

  return files.map((file) => ({ path: file.path, hunks: splitDiffHunks(file.lines.join('\n')) }))
}

/**
 * `diff --git a/foo b/foo` → `foo`. **뒤쪽(b/)을 쓴다** — 이름이 바뀐 커밋에서
 * 지금 이름이 뒤에 온다.
 *
 * 경로에 공백이 있으면 git 이 따옴표로 묶어 낸다(`"a/f o" "b/f o"`). 그때는
 * 조각이 어긋나므로 **머리 줄 원문을 그대로** 쓴다 — 엉뚱한 이름을 지어내지 않는다.
 */
function pathOfHeader(line: string): string {
  const rest = line.slice('diff --git '.length)
  const parts = rest.split(' ')
  const tail = parts[parts.length - 1]
  if (parts.length !== 2 || tail === undefined || !tail.startsWith('b/')) return rest
  return tail.slice(2)
}
