import { useEffect } from 'react'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import { STATUS_LABEL, type ProjectStatus } from '../state/projectStatus'
import { FileTree } from './FileTree'
import { FileTreeOverlays } from './FileTreeOverlays'
import { useFileTreeActions } from '../state/useFileTreeActions'
import { HistoryList } from './HistoryList'
import { GitPanel } from './GitPanel'
import type { GitBranchMenu } from './GitBranchChip'
import { SidebarPanelSelect } from './SidebarPanelSelect'
import { RunPanel } from './RunPanel'
import type { ShellDrawer } from '../state/useShellDrawer'
import { ExtensionViewPanel } from './ExtensionViewPanel'
import { useExtensionPanel } from '../state/useExtensionPanel'
import { useSidebarPanel } from '../state/useSidebarPanel'
import { extensionPanelTargets, isExtensionPanelId } from '../state/extensionPanels'
import { commandSlots } from '../state/extensionCommandSlots'
import type { FileTreeApi } from '../state/useFileTree'
import type { HistoryStatePayload } from '../../shared/ipc/channels'
import type { GitStateHandle } from '../state/useGitState'
import { buildBadges } from '../state/gitBadge'
import type { GitPanelActions } from '../state/useGitActions'
import type { GitBulkActions } from '../state/useGitBulkActions'
import { t } from '../i18n/messages'

// 좌측 사이드바 — 선택된 프로젝트의 내용 (설계 §7).
//
// **프로젝트 이름은 여기 두지 않는다.** 탭이 이미 보여주고 있어
// 두 번 나오면 어느 쪽이 무엇인지 헷갈린다. 이름 변경은 탭에서 한다.
// 즐겨찾기는 선택기 줄 끝에 둔다 — 별은 한 군데에만 있어야 한다.
//
// 무엇을 보여줄지는 위의 선택기가 정한다 (프로젝트 / 소스 관리 / 채팅이력).

export interface ProjectSidebarProps {
  project: ProjectRecord
  status: ProjectStatus
  tree: FileTreeApi
  onPickFile: (path: string) => void
  /**
   * 파일을 연다. `revealLine` 은 1-based — 확장 결과 행에서 파일:라인으로 이동할 때 쓴다.
   *
   * App 이 넘기는 `useOpenFiles.open` 이 원래 이 시그니처다(`useOpenFiles.ts:76`).
   * 여기서 좁혀 받고 있었을 뿐이라, 넓히는 것으로 호출부는 그대로다.
   */
  onOpenFile: (path: string, revealLine?: number) => void
  /**
   * 확장 화면을 본문 탭으로 연다 (`useOpenFiles.openHtml`).
   *
   * 사이드바가 직접 그리지 않는다 — 폭에 분석 표가 안 들어간다.
   * 명령은 왼쪽에서 걸고 결과는 오른쪽에서 본다.
   */
  onOpenHtml: (key: string, label: string, html: string, focus?: boolean, extension?: string) => void
  onTestConnection: () => void
  /** 설정이 비어 대화가 안 되는 경우의 사유. 있으면 상태 대신 이걸 보여준다. */
  setupReason?: string
  onFavorite: () => void
  git: GitStateHandle
  /** git 패널에서 파일을 눌렀을 때 */
  onOpenDiff: (path: string, staged: boolean) => void
  /** git 패널 행동 묶음 — 확인·알림은 App 이 맡는다 */
  gitActions: GitPanelActions
  /**
   * 묶음 행동 (모두 담기 / 모두 취소) — 소스 관리 탭과 같은 훅을 쓴다.
   * 주지 않으면 `GitPanel` 이 그 버튼을 그리지 않는다 (그쪽 규칙 그대로 흘려보낸다).
   */
  gitBulk?: GitBulkActions
  /**
   * 브랜치 칩의 전환·생성 메뉴 (`useAppGit`).
   * 주지 않으면 `GitPanel` 이 캐럿을 그리지 않는다 — 칩을 눌러도 아무 일이 없다(QA D6).
   */
  branchMenu?: GitBranchMenu
  /** 본문에 소스 관리 탭을 연다. ⚙ 메뉴의 `onScm` 과 **같은 함수**다. */
  onOpenScm?: () => void
  history: HistoryStatePayload
  /**
   * 하단 셸 드로어 (`useShellDrawer`). 「실행」 패널이 ▶ 로 띄운 칸을 여기 탭으로 띄우고,
   * ■ 로 닫는다 — **탭이 곧 멈추는 문**이라 목록과 드로어가 같은 상태를 봐야 한다.
   */
  shell: ShellDrawer
  onToast: (text: string) => void
  /** 대화가 준비됐는지 — 새 대화 버튼 활성 근거 */
  newChatDisabled?: boolean
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  // 무엇을 보고 있는지는 **프로젝트마다 따로**다 (`useSidebarPanel`)
  const { panel, select: setPanel } = useSidebarPanel(props.project.id)

  // 확장 목록·결과 행. **패널을 보고 있지 않아도 켠다** — 선택기에 항목을 그리려면
  // 목록이 먼저 있어야 한다. 이력·git 처럼 여기서 IPC 를 직접 문다.
  const extensions = useExtensionPanel({
    projectId: props.project.id,
    active: true,
    onNotice: props.onToast,
    onOpenFile: props.onOpenFile,
  })
  const panels = extensionPanelTargets(extensions.extensions)
  const target = panels.find((option) => option.id === panel) ?? null
  // 준비 행동(목록 갱신)은 **헤더 오른쪽**이다 — 프로젝트당 한 번이면 되는 일이라
  // 주 행동과 크기가 달라야 잘못 누르지 않는다 (기획서 §3).
  // 트리 우클릭(만들기·이름변경·휴지통). 메뉴와 창은 아래에서 그린다 —
  // **트리 안에 그리면 스크롤 칸에 잘린다** (`FileTreeMenu` 머리말).
  const files = useFileTreeActions(props.project.id, props.tree.refresh, props.onToast)

  const headerCommands = target === null ? [] : commandSlots(target.extension.contributes?.commands ?? []).header

  // 보고 있던 확장이 지워지면(설정 창에서 삭제) 그릴 것이 없다. 빈 화면에 가두지 않고
  // 프로젝트로 되돌린다. 고를 수 있는 것은 늘 목록에서 나오므로 이 자리는 사라질 때만 탄다.
  useEffect(() => {
    if (isExtensionPanelId(panel) && !panels.some((option) => option.id === panel)) setPanel('files')
  }, [panel, panels, setPanel])

  // 이력은 **보이게 될 때마다** 다시 받는다 — 다른 창에서 대화가 늘었을 수 있다.
  // 고를 때만 받으면, 이력을 보던 프로젝트로 되돌아왔을 때 낡은 목록이 그대로 남는다
  // (선택이 프로젝트마다 기억되면서 생긴 자리다).
  useEffect(() => {
    if (panel === 'history') void window.davis.requestHistoryList()
  }, [panel, props.project.id])

  return (
    <aside className="dc-sidebar" aria-label={t('프로젝트 정보')}>
      <div className="dc-sidebar__head">
        <SidebarPanelSelect
          panel={panel}
          extensionPanels={panels}
          // 설정 창에서 방금 설치했을 수 있다 — 펼치는 순간 다시 받는다
          onOpen={extensions.refresh}
          onChange={setPanel}
        />

        {headerCommands.map((command) => {
          const running = extensions.running.includes(command.id)
          // **글리프만 그리는 갈래**는 확장이 `icon` 을 적었을 때만이다. 안 적은 확장은
          // 예전 그대로 `↻` + 글자로 남는다 — 이미 쓰이던 자리를 말없이 바꾸지 않는다.
          const iconOnly = command.icon !== undefined
          return (
            <button
              key={command.id}
              type="button"
              className={`dc-sidebar__extcmd${iconOnly ? ' dc-sidebar__extcmd--icon' : ''}`}
              disabled={running}
              // 글자가 없으면 **무엇을 누르는지 말할 것이 여기뿐이다.** 툴팁과 낭독기 이름
              // 둘 다 준다 — 마우스가 없는 사람에게 툴팁은 없는 것과 같다.
              title={command.title}
              aria-label={iconOnly ? command.title : undefined}
              // 준비 행동에는 고른 것을 싣지 않는다 — 목록을 다시 만드는 일이라 대상이 없다
              onClick={() => extensions.runCommand(command.id)}
            >
              {/* 도는 동안 글자가 「실행 중…」으로 바뀌는 것이 예전에는 유일한 신호였다.
                  글리프만 남는 갈래에는 그 자리가 없으므로 도는 표시를 그림으로 바꿔 준다 —
                  안 그러면 눌렀는지 안 눌렀는지 화면이 말하지 않는다. */}
              {running && iconOnly ? (
                <span className="ext-progress__spin" aria-hidden="true" />
              ) : (
                <span aria-hidden="true">{command.icon ?? '↻'}</span>
              )}
              {iconOnly ? null : running ? t('실행 중…') : command.title}
            </button>
          )
        })}

        {/* 즐겨찾기는 프로젝트를 볼 때만 — 채팅이력은 대화 목록이지 프로젝트 설정이 아니다 */}
        {panel === 'files' && (
        <button
          type="button"
          className={`dc-sidebar__star${props.project.favorite ? ' dc-sidebar__star--on' : ''}`}
          onClick={props.onFavorite}
          title={props.project.favorite ? t('즐겨찾기 해제') : t('즐겨찾기')}
          aria-pressed={props.project.favorite}
        >
          {props.project.favorite ? '★' : '☆'}
        </button>
        )}
      </div>

      {/* 세 갈래를 중첩 삼항으로 쓰면 패널이 늘 때마다 한 겹씩 깊어진다 */}
      <div className="dc-sidebar__body">
        {panel === 'files' && (
          <FileTree
            tree={props.tree}
            onOpenFile={props.onOpenFile}
            onPickFile={props.onPickFile}
            badges={buildBadges(props.git.state)}
            onContextMenu={files.openMenu}
          />
        )}
        {panel === 'git' && (
          <GitPanel
            state={props.git.state}
            loading={props.git.loading}
            onRefresh={props.git.refetch}
            onOpenDiff={props.onOpenDiff}
            onToggle={props.git.toggle}
            onRevert={props.gitActions.onRevert}
            onPull={props.gitActions.onPull}
            onCommit={props.gitActions.onCommit}
            onPush={props.gitActions.onPush}
            {...(props.gitBulk
              ? { onStageAll: props.gitBulk.onStageAll, onUnstageAll: props.gitBulk.onUnstageAll }
              : {})}
            {...(props.branchMenu ? { branchMenu: props.branchMenu } : {})}
            {...(props.onOpenScm ? { onOpenScm: props.onOpenScm } : {})}
          />
        )}
        {panel === 'run' && (
          <RunPanel
            // 프로젝트를 옮기면 목록을 처음부터 읽는다 — 남의 프로젝트 명령을 여기서 띄우면 안 된다
            key={props.project.id}
            projectId={props.project.id}
            shell={props.shell}
            onToast={props.onToast}
          />
        )}
        {panel === 'history' && (
          <HistoryList
            entries={props.history.entries}
            loading={props.history.loading}
            onNewChat={() => void window.davis.resetChat()}
            newChatDisabled={props.newChatDisabled}
            onSelect={(chatId) =>
              chatId === props.history.current?.chatId
                ? props.onToast(t('이미 선택된 대화입니다'))
                : void window.davis.loadHistory({ chatId })
            }
            // 거르기는 **서버가 한다** — 검색어를 그대로 실어 목록을 다시 받는다
            onSearch={(query) => void window.davis.requestHistoryList(query ? { search: query } : undefined)}
            onRemove={(chatId) => {
              // 지운 대화는 **못 되살린다** (`DELETE /session/:id`). 되돌릴 수 없는 것은
              // 한 번 묻는 것이 이 레포의 규칙이다 (`useGitActions.ts` 의 되돌리기와 같은 결).
              if (!window.confirm(t('이 대화를 지울까요? 되돌릴 수 없습니다.'))) return
              void window.davis.removeHistory({ chatId })
            }}
          />
        )}
        {target !== null && (
          <ExtensionViewPanel
            // 확장을 바꾸면 거르개·정렬을 처음부터 — 앞 확장의 확장자·열은 여기 없다
            key={target.id}
            target={target}
            // 뷰별 결과를 **통째로** 넘긴다 — 패널 안에서 탭으로 뷰를 가르므로 어느 뷰의
            // 것을 그릴지는 저쪽이 정한다. 여기서 하나만 골라 넘기면 탭을 옮길 때마다
            // 사이드바가 다시 렌더돼야 한다.
            rowsByView={extensions.rowsByView}
            htmlByView={extensions.htmlByView}
            treesByView={extensions.treesByView}
            expanded={extensions.expanded}
            // 고른 것·펼친 것을 프로젝트별로 가르는 열쇠 — 탭을 다녀와도 자리가 남는다
            projectId={props.project.id}
            running={extensions.running}
            // 통째로 넘긴다 — 어느 확장의 줄을 그릴지는 자기가 누구인지 아는 저쪽이 정한다
            progressByExtension={extensions.progressByExtension}
            progressLog={extensions.progressLog}
            onRunCommand={extensions.runCommand}
            onCancel={extensions.cancel}
            onOpenRow={extensions.openRow}
            onOpenPath={(path) => props.onOpenFile(path)}
            onOpenHtml={props.onOpenHtml}
            onNotice={props.onToast}
          />
        )}
      </div>

      {/* 경로와 상태는 아래에 둔다 — 늘 보이되 목록을 밀어내지 않는다 */}
      <div className="dc-sidebar__foot">
        <div className="dc-sidebar__path" title={props.project.root}>
          {props.project.root}
        </div>
        {props.setupReason ? (
          <button
            type="button"
            className="dc-sidebar__status dc-sidebar__status--error"
            // 연결에 필요한 값(주소·키)을 넣는 자리는 **연결 팝업**이다 — 설정 창에는 연결 항목이 없다.
            // 설정 창을 열면 사용자가 넣을 곳을 못 찾고 갇힌다 (가이드 검토에서 드러남).
            onClick={props.onTestConnection}
            title={props.setupReason}
          >
            <span className="project-tab__dot project-tab__dot--error" />
            {t('설정이 필요합니다')}
          </button>
        ) : (
          <button
            type="button"
            className={`dc-sidebar__status dc-sidebar__status--${props.status}`}
            onClick={props.onTestConnection}
            title={t('연결 테스트')}
          >
            <span className={`project-tab__dot project-tab__dot--${props.status}`} />
            {t(STATUS_LABEL[props.status])}
          </button>
        )}
      </div>

      {/* 메뉴·이름 창은 트리 **바깥 층**에 뜬다 — 트리는 스크롤 칸이라 안에 그리면 잘린다 */}
      <FileTreeOverlays files={files} extensions={extensions} />
    </aside>
  )
}
