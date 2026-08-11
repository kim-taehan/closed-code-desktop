import type { GitBranchEntry, GitStashEntry } from '../../shared/git/gitRefs'
import type { GitRefActions } from '../state/useGitRefActions'
import type { GitRefsHandle } from '../state/useGitRefs'
import { formatGitWhen } from '../utils/gitWhen'
import { ScmNameForm } from './ScmNameForm'

// 「브랜치」 갈래 — 로컬 / 원격 / 임시저장 세 칸 (목업 안 A).
//
// **안전 삭제(-d)와 강제 삭제(-D)를 화면에서도 가른다.** main 이 채널을 갈라 둔 이유가
// 여기서도 살아야 한다 — 병합 안 된 브랜치를 지우려다 안전 삭제가 거절되면 그
// **git 문구를 그대로** 보여 준다. "머지 안 됨" 을 우리 말로 바꾸면 사용자가 검색해 찾을 수 없다.
//
// 「내용 보기」(`gitStashShow`)는 채널이 있지만 그리지 않았다 — 임시저장 diff 를 놓을
// 자리가 이 3칸 안에 없다. 없는 자리를 만들기보다 다음 사람이 정하게 둔다.

export interface ScmBranchesProps {
  refs: GitRefsHandle
  actions: GitRefActions
}

export function ScmBranches({ refs, actions }: ScmBranchesProps) {
  const local = refs.branches.filter((branch) => !branch.remote)
  const remote = refs.branches.filter((branch) => branch.remote)

  return (
    <div className="scm-refs">
      {refs.error !== null && <p className="git-empty git-empty--error">{refs.error}</p>}

      <div className="scm-refs__cols">
        <section className="scm-refs__col">
          <ColumnHead title="로컬" count={local.length}>
            <ScmNameForm label="+ 새 브랜치" placeholder="새 브랜치 이름" onSubmit={actions.onCreate} />
          </ColumnHead>
          {local.length === 0 ? (
            <Empty loading={refs.loading} text="로컬 브랜치가 없습니다." />
          ) : (
            local.map((branch) => (
              <LocalRow key={branch.name} branch={branch} actions={actions} />
            ))
          )}
        </section>

        <section className="scm-refs__col">
          <ColumnHead title="원격" count={remote.length} />
          {remote.length === 0 ? (
            <Empty loading={refs.loading} text="원격 브랜치가 없습니다." />
          ) : (
            remote.map((branch) => (
              <div className="scm-ref-row" key={branch.name}>
                <span className="scm-ref-row__name" title={branch.name}>
                  {branch.name}
                </span>
                <span className="scm-ref-row__when">{formatGitWhen(branch.date)}</span>
                <span className="scm-ref-row__acts">
                  {/* 원격 브랜치에 전환을 부르면 git 이 거절한다 — 받아오기만 둔다 */}
                  <button
                    type="button"
                    className="scm-btn"
                    disabled={actions.busy}
                    onClick={() => actions.onTrack(branch.name)}
                  >
                    로컬로 받아오기
                  </button>
                </span>
              </div>
            ))
          )}
        </section>

        <section className="scm-refs__col">
          <ColumnHead title="임시저장" count={refs.stashes.length}>
            <ScmNameForm
              label="+ 지금 것 저장"
              placeholder="무엇을 담는지"
              onSubmit={actions.onStash}
            />
          </ColumnHead>
          {refs.stashes.length === 0 ? (
            <Empty loading={refs.loading} text="치워 둔 것이 없습니다." />
          ) : (
            refs.stashes.map((stash) => <StashRow key={stash.ref} stash={stash} actions={actions} />)
          )}
        </section>
      </div>
    </div>
  )
}

function ColumnHead({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children?: React.ReactNode
}) {
  return (
    <div className="scm-refs__head">
      <span className="git-group__title">
        {title} <span className="git-group__count">{count}</span>
      </span>
      {children}
    </div>
  )
}

function Empty({ loading, text }: { loading: boolean; text: string }) {
  return <p className="git-empty">{loading ? '읽는 중…' : text}</p>
}

function LocalRow({ branch, actions }: { branch: GitBranchEntry; actions: GitRefActions }) {
  return (
    <div className={`scm-ref-row${branch.current ? ' scm-ref-row--on' : ''}`}>
      <span className="scm-ref-row__mark" aria-hidden="true">
        {branch.current ? '●' : ''}
      </span>
      <span className="scm-ref-row__name" title={branch.name}>
        {branch.name}
      </span>
      {/* 추적 문구는 git 원문(`[ahead 1]`·`[gone]`)이다 — 숫자로 풀면 숫자 아닌 상태를 흘린다 */}
      {branch.track === '' ? (
        <span className="scm-ref-row__when">{formatGitWhen(branch.date)}</span>
      ) : (
        <span className="scm-ref-row__track">{branch.track}</span>
      )}

      {/* 지금 있는 브랜치로는 옮길 수도, 자기 자신에 병합할 수도, 지울 수도 없다 */}
      {!branch.current && (
        <span className="scm-ref-row__acts">
          <button
            type="button"
            className="scm-btn"
            disabled={actions.busy}
            onClick={() => actions.onSwitch(branch.name)}
          >
            전환
          </button>
          <button
            type="button"
            className="scm-btn"
            disabled={actions.busy}
            onClick={() => actions.onMerge(branch.name)}
          >
            현재에 병합
          </button>
          <button
            type="button"
            className="scm-btn scm-btn--ghost"
            disabled={actions.busy}
            title="병합한 브랜치만 지워진다 (-d)"
            onClick={() => actions.onDelete(branch.name)}
          >
            삭제
          </button>
          <button
            type="button"
            className="scm-btn scm-btn--danger"
            disabled={actions.busy}
            title="병합하지 않은 커밋까지 지운다 (-D)"
            onClick={() => actions.onForceDelete(branch.name)}
          >
            강제 삭제
          </button>
        </span>
      )}
    </div>
  )
}

function StashRow({ stash, actions }: { stash: GitStashEntry; actions: GitRefActions }) {
  return (
    <div className="scm-ref-row">
      <span className="scm-ref-row__name" title={`${stash.ref} · ${stash.label}`}>
        {stash.label}
      </span>
      <span className="scm-ref-row__when">{formatGitWhen(stash.date)}</span>
      <span className="scm-ref-row__acts">
        {/* 복원해도 목록에 남는다 — 버리기와 갈라 둔 것이 화면에서도 보여야 한다 */}
        <button
          type="button"
          className="scm-btn"
          disabled={actions.busy}
          onClick={() => actions.onApplyStash(stash.ref)}
        >
          복원
        </button>
        <button
          type="button"
          className="scm-btn scm-btn--danger"
          disabled={actions.busy}
          onClick={() => actions.onDropStash(stash.ref)}
        >
          버리기
        </button>
      </span>
    </div>
  )
}
