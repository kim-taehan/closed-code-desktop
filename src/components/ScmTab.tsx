import type { GitState } from '../../shared/git/gitState'
import type { ToastApi } from '../state/useToasts'
import type { ScmView, ScmViewHandle } from '../state/useScmView'
import { useGitRefs } from '../state/useGitRefs'
import { useGitRefActions } from '../state/useGitRefActions'
import { GitBranchBar } from './GitBranchBar'
import { ScmBranches } from './ScmBranches'
import { ScmChanges, type ScmChangesWiring } from './ScmChanges'
import { ScmHistory } from './ScmHistory'
import '../styles/git.css'
import '../styles/scm.css'

// 소스 관리 탭 — 본문 전체를 쓰는 git 화면 (안 A).
//
// 사이드바(GitPanel)와 **같은 상태**를 그린다. 맨 윗줄은 GitBranchBar 를 그대로 쓴다 —
// ↑↓ 규칙(마지막으로 받아온 원격 기준, 둘 다 0이면 안 그림)이 두 화면에서 갈리면
// 같은 저장소가 자리마다 다르게 보인다. git.css 도 그래서 함께 들여온다.

const VIEW_ORDER: ScmView[] = ['changes', 'history', 'branches']
const VIEW_LABEL: Record<ScmView, string> = {
  changes: '변경사항',
  history: '히스토리',
  branches: '브랜치',
}

export interface ScmTabProps {
  state: GitState
  loading: boolean
  onRefresh: () => void
  /** 원격이 앞설 때(behind>0) 당겨오기 — 사이드바와 같은 행동 묶음을 쓴다 */
  onPull: () => void
  view: ScmViewHandle
  /** 브랜치 개수. 목록을 아직 읽어 오지 않았으면 주지 않는다 — 0 을 지어내지 않는다. */
  branchCount?: number
  /**
   * 「변경사항」 갈래에 필요한 배선 (프로젝트·행동·알림).
   *
   * **주지 않으면 그 갈래 본문이 빈 채로 있다.** 껍데기만 띄우는 자리(테스트 등)에서
   * 부를 수 있어야 해 optional 이다.
   */
  changes?: ScmChangesWiring
  /**
   * 「히스토리」·「브랜치」 갈래에 필요한 배선.
   *
   * `changes` 와 같은 규칙 — **주지 않으면 그 갈래 본문이 빈 채로 있다.** 두 갈래가
   * 부르는 것은 전부 요청-응답 조회라 프로젝트와 알림만 있으면 된다.
   */
  refs?: ScmRefsWiring
}

export interface ScmRefsWiring {
  projectId: string | null
  toasts: ToastApi
}

/** 알림 자리를 안 받은 경우(껍데기만 띄우는 자리). 부를 행동도 없으니 아무 데도 안 간다. */
const NO_TOASTS: ToastApi = { toasts: [], show: () => {}, dismiss: () => {} }

export function ScmTab(props: ScmTabProps) {
  const { state, view } = props
  // 브랜치·임시저장은 **탭이 쥔다.** 브랜치 칩의 전환 메뉴와 「브랜치」 갈래가 같은 목록을
  // 봐야 해서다 — 갈래 안에서 읽으면 칩이 빈 메뉴를 열게 된다.
  // 저장소가 아니면 물어볼 것도 없다 (아래 이른 반환 자리와 같은 판정).
  const projectId = state.isRepo ? (props.refs?.projectId ?? null) : null
  const refs = useGitRefs(projectId)
  const refActions = useGitRefActions(projectId, refs, props.refs?.toasts ?? NO_TOASTS)

  // 사이드바와 같은 문구를 쓴다 (GitPanel) — 같은 사실을 두 자리에서 다르게 말하지 않는다
  if (!state.isRepo) return <p className="git-empty">git 저장소가 아닙니다.</p>
  if (state.error !== undefined) return <p className="git-empty git-empty--error">{state.error}</p>

  // 목록을 아직 못 읽었으면 0 을 지어내지 않는다 — 위에서 준 값이 있으면 그것이 먼저다
  const branchCount =
    props.branchCount ?? (refs.branches.length === 0 ? undefined : refs.branches.length)
  const count: Partial<Record<ScmView, number>> = {
    changes: changedCount(state),
    ...(branchCount === undefined ? {} : { branches: branchCount }),
  }
  const localBranches = refs.branches.filter((branch) => !branch.remote)

  return (
    <div className="scm-tab">
      <GitBranchBar
        state={state}
        busy={props.loading}
        // ⟳ 는 상태만 다시 읽는다 — 브랜치·임시저장 목록은 밀려오지 않으므로
        // (`useGitRefs` 머리말) 여기서 같이 읽어야 한쪽만 옛것으로 남지 않는다
        onRefresh={() => {
          props.onRefresh()
          void refs.reload()
        }}
        onPull={props.onPull}
        {...(props.refs
          ? {
              branchMenu: {
                branches: localBranches,
                busy: refActions.busy,
                onSwitch: refActions.onSwitch,
                onCreate: refActions.onCreate,
              },
            }
          : {})}
      />

      <div className="scm-views" role="tablist" aria-label="소스 관리 갈래">
        {VIEW_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view.view === id}
            className={`scm-view${view.view === id ? ' scm-view--active' : ''}`}
            onClick={() => view.selectView(id)}
          >
            {VIEW_LABEL[id]}
            {count[id] !== undefined && <span className="scm-view__count">{count[id]}</span>}
          </button>
        ))}
      </div>

      {/* 갈래 본문 자리. 스크롤은 여기가 쥔다 (FileDiffView 는 스크롤을 소유하지 않는다). */}
      <div className="scm-pane" role="tabpanel" aria-label={VIEW_LABEL[view.view]}>
        {view.view === 'changes' && props.changes && (
          <ScmChanges {...props.changes} state={state} loading={props.loading} view={view} />
        )}
        {view.view === 'history' && props.refs && (
          <ScmHistory projectId={props.refs.projectId} view={view} />
        )}
        {view.view === 'branches' && props.refs && (
          <ScmBranches refs={refs} actions={refActions} />
        )}
      </div>
    </div>
  )
}

/** 바뀐 파일 수 — 담아 둔 뒤 또 고친 파일은 양쪽 묶음에 다 있지만 한 번만 센다. */
function changedCount(state: GitState): number {
  return new Set([...state.staged, ...state.unstaged].map((entry) => entry.path)).size
}
