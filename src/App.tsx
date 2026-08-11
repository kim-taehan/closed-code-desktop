import { useEffect, useRef, useState } from 'react'
import { ChatComposer } from './components/ChatComposer'
import type { PermissionMode } from '../shared/protocol/kinds'
import { useAttachments } from './state/useAttachments'
import { useStickToBottom } from './state/useStickToBottom'
import { InterruptCards } from './components/InterruptCards'
import { useTheme } from './state/useTheme'
import { MainBar } from './components/MainBar'
import { setOpenFileHandler } from './state/slashCommands'
import { AppDialogs } from './components/AppDialogs'
import { useAppSettings } from './state/useAppSettings'
import { useMcpState } from './state/useMcpState'
import { useShortcuts } from './state/useShortcuts'
import { activeReviewOf, sendReviewDecision } from './state/activeReview'
import { ProjectRail } from './components/ProjectRail'
import { ProjectSidebar } from './components/ProjectSidebar'
import { AppLauncherGate } from './components/AppLauncherGate'
import { useProjects } from './state/useProjects'
import { useSessionState } from './state/useSessionState'
import { projectStatus } from './state/projectStatus'
import { useFileTree } from './state/useFileTree'
import { useToasts } from './state/useToasts'
import { useDevPhrase } from './state/devMode'
import { useNotifications } from './state/useNotifications'
import { useSidebarWidth } from './state/useSidebarWidth'
import { SidebarResizer } from './components/SidebarResizer'
import { useFavoriteWithToast } from './state/useGitActions'
import { useAppGit } from './state/useAppGit'
import { ToastStack } from './components/ToastStack'
import { useOpenFiles } from './state/useOpenFiles'
import { useActiveFileNotice } from './state/useActiveFileNotice'
import { useMouseGesture } from './state/useMouseGesture'
import { tabNavigation } from './state/tabCycle'
import { projectNavigation } from './state/projectCycle'
import { MainView } from './components/MainView'
import { hidesComposer, SCM_TAB, useScmView } from './state/useScmView'
import './lib/davis-progress/styles.css'
import './styles/chat.css'

// 화면 조립. 상태 구독과 전송만 하고, 렌더 규칙은 MessageList 아래가 담당한다.
//
// 세션 상태는 프로젝트마다 따로 쌓인다 (useSessionState) — 여기서는 활성 것만 그린다.

export function App() {
  const theme = useTheme()
  const projects = useProjects()
  const sessions = useSessionState(projects.activeId)
  const { session, snapshot, history, reviews, permissionMode, workingDir, approvals, questions, plans, isStreaming } =
    sessions.active
  // "+" 는 폴더 대화상자로 직행하지 않고 런처를 거친다 (아는 프로젝트 재오픈이 더 흔하다)
  const [launcher, setLauncher] = useState(false)
  // 파일 트리 경로를 입력창으로 보내는 통로. nonce 로 같은 파일 두 번 골라도 반응하게 한다.
  const [insert, setInsert] = useState({ text: '', nonce: 0 })
  const tree = useFileTree(projects.activeId)
  const toasts = useToasts()
  const sidebar = useSidebarWidth()
  const appSettings = useAppSettings()
  const devPhrase = useDevPhrase(appSettings) // 개발자 모드 이스터에그 (스펙 11_spec_devmode)
  // 작업 완료 알림 설정을 그대로 쓴다 — 같은 성격(내 작업 결과)이라 토글을 새로 만들지 않는다
  useNotifications(projects.activeId, toasts, appSettings.value.taskDoneNotify)
  // git 배선 한 묶음 — 상태·행동·묶음 행동·브랜치 메뉴 (`useAppGit`)
  const { git, gitActions, gitBulk, branchMenu } = useAppGit(projects.activeId, toasts, isStreaming)
  const toggleFavorite = useFavoriteWithToast(projects.favorite, toasts)
  const [testing, setTesting] = useState(false)
  const [settings, setSettings] = useState(false)
  // 로그는 파일과 같은 층의 탭이다. 열면 그 탭으로 옮겨 간다.
  const [logs, setLogs] = useState(false)
  // 소스 관리도 같은 층이다 (안 A). 탭 안의 갈래·선택은 탭을 떠나도 남아야 해 여기서 쥔다.
  const [scm, setScm] = useState(false)
  const scmView = useScmView(projects.activeId)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [palette, setPalette] = useState<'quickOpen' | 'search' | null>(null)
  const mcp = useMcpState(projects.activeId)
  // 우클릭 제스처: ㄴ = 탭 닫기, ←·→ = 탭 순환. 대화 영역은 이동만 — ㄴ 은 대화 탭에서
  // closeActive 가 no-op 이라 조용히 무시된다 (에러/토스트 없음, 스펙). 본문 뷰는 동시에
  // 하나만 렌더되므로 인스턴스 하나를 세 래퍼가 나눠 쓴다.
  const gesture = useMouseGesture((kind) => {
    if (kind === 'L') nav.closeActive()
    else if (kind === 'swipe-right') nav.next()
    else nav.prev()
  })

  // ⌘/Ctrl + ←·→ — 프로젝트 탭 전환 (projectCycle.ts). 옮겨 갈 곳이 없으면 아무 일도 안 한다.
  const projectNav = projectNavigation(projects)

  // 설정이 비어 있으면 최초 등록 팝업을 연다 — 자동 오픈 게이트는 AppDialogs 가 쥔다
  const attachments = useAttachments()
  // 스트리밍으로 내용이 늘면 따라 내려간다 (위로 올려 읽는 중이면 그대로 둔다)
  const scrollRef = useRef<HTMLDivElement>(null)
  useStickToBottom(scrollRef, snapshot.messages)
  // 외부 열기(pdf 등) 실패는 화면에 흔적이 없다 — 알림으로만 알 수 있다
  const openFiles = useOpenFiles(projects.activeId, toasts.show)
  // 보고 있는 파일을 확장에 알린다 (`useActiveFileNotice` 머리말)
  useActiveFileNotice(openFiles.chatContext)
  // /open 으로 고른 파일 열기 — pdf·zip 라우팅은 이 경로만 탄다 (트리·검색은 뷰어 그대로).
  useEffect(() => setOpenFileHandler(openFiles.openRouted), [openFiles.openRouted])
  // 이미 열려 있으면 탭을 새로 만들지 않고 그 탭으로 간다 (boolean + select).
  // ⚙ 메뉴와 사이드바 「전체 화면에서 보기」가 **같은 함수**를 쓴다 — 두 문이 갈리면 안 된다.
  const openScm = () => {
    setScm(true)
    openFiles.select(SCM_TAB)
  }
  // ⚙ 메뉴의 「로그 보기」와 ⌘L 이 **같은 함수**를 쓴다 (openScm 과 같은 이유)
  const openLogs = () => { setLogs(true); openFiles.select('logs') }
  // 탭 순환·닫기 — ⌘W·Ctrl+Tab 과 ←·→ 제스처가 같은 경로를 쓴다 (tabCycle.ts)
  const nav = tabNavigation(openFiles, logs, () => setLogs(false), {
    open: scm,
    close: () => setScm(false),
  })

  // ⌘Enter 가 겨눌 리뷰 카드 하나 (activeReview.ts — 카드와 같은 판정을 쓴다).
  // 위에 뜬 창이 있으면 끈다: 설정·팔레트·승인 모달이 열려 있는데 뒤쪽 카드가 적용되면 안 된다.
  // 대화 화면일 때만 산다 (파일 탭엔 카드가 안 보인다).
  const reviewTarget = activeReviewOf(reviews.reviews)
  // 본체 대신 전체 화면(런처)이 뜨는 조건. 아래 early-return 과 **같은 값을 쓴다** —
  // 따로 쓰면 런처를 띄운 채 뒤쪽 카드가 조작되는 어긋남이 생긴다.
  const launcherScreen = !projects.loaded || projects.open.length === 0 || launcher
  const overlay =
    launcherScreen || palette !== null || settings || testing || mcpOpen ||
    approvals.length > 0 || questions.length > 0 || plans.length > 0
  const reviewKeys =
    reviewTarget !== null && openFiles.active === 'chat' && !overlay ? reviewTarget.actions : []

  useShortcuts(
    {
      onQuickOpen: () => setPalette('quickOpen'),
      onSearch: () => setPalette('search'),
      onNewChat: () => void window.davis.resetChat(),
      onSettings: () => setSettings(true),
      // 크롬식 탭 조작. 닫을 탭이 없으면(대화만) 무시 — 창을 닫지 않는다 (사용자 결정)
      onCloseTab: () => nav.closeActive(),
      onNextTab: () => nav.next(),
      onPrevTab: () => nav.prev(),
      onNextProject: projectNav.next,
      onPrevProject: projectNav.prev,
      onCancelTurn: () => void window.davis.cancelChat(),
      onAcceptReview: () => {
        if (reviewTarget) sendReviewDecision(reviewTarget.review.turnId, 'accept')
      },
      // ⌘L 은 개발자 모드에서만 넘긴다 — ⚙ 메뉴의 「로그 보기」와 같은 조건이어야 한다
      ...(appSettings.value.developerMode ? { onLogs: openLogs } : {}),
    },
    // 넷 다 프로젝트가 있어야 뜻이 있다 (설정 창도 프로젝트 라이선스를 다룬다).
    // 없을 때 켜 두면 눌러도 아무 일이 없어 사용자가 자기 탓으로 여긴다.
    projects.activeId !== null,
    {
      streaming: isStreaming,
      canAcceptReview: reviewKeys.includes('accept'),
    },
  )

  const ready = (session?.handshake.stage ?? 'idle') === 'ready'

  // 첫 목록 대기·프로젝트 없음·런처 — 본체 대신 전체 화면 분기 (AppLauncherGate 로 분리)
  if (launcherScreen) {
    return <AppLauncherGate projects={projects} onCancel={() => setLauncher(false)} />
  }

  const activeProject = projects.open.find((project) => project.id === projects.activeId) ?? null
  const statusOf = (id: string) => projectStatus(sessions.slices[id])

  return (
    <div className="app-shell app-shell--with-projects">
      <ProjectRail
        open={projects.open}
        activeId={projects.activeId}
        statusOf={statusOf}
        onActivate={projects.activate}
        onClose={projects.close}
        onRename={projects.rename}
        onPick={() => setLauncher(true)}
        onSearchFiles={() => setPalette('quickOpen')}
        menu={{
          onSettings: () => setSettings(true),
          onLogs: openLogs,
          developerMode: appSettings.value.developerMode,
        }}
      />

      <div className={`app-body${sidebar.dragging ? ' app-body--resizing' : ''}`} style={{ gridTemplateColumns: `${sidebar.width}px 1fr` }}>
      {activeProject && (
        <ProjectSidebar
          project={activeProject}
          status={statusOf(activeProject.id)}
          tree={tree}
          onPickFile={(path) => setInsert(({ nonce }) => ({ text: path, nonce: nonce + 1 }))}
          onOpenFile={openFiles.open}
          onOpenHtml={openFiles.openHtml}
          onTestConnection={() => setTesting(true)}
          onFavorite={() => toggleFavorite(activeProject)}
          git={git}
          onOpenDiff={openFiles.openDiff}
          gitActions={gitActions}
          gitBulk={gitBulk}
          branchMenu={branchMenu}
          onOpenScm={openScm}
          history={history}
          onToast={toasts.show}
          newChatDisabled={!ready || isStreaming}
        />
      )}
      {activeProject && <SidebarResizer sidebar={sidebar} />}

      <div className="app-main">
      {projects.error && (
        <div className="dc-projects__error" role="alert" onClick={projects.dismissError}>
          {projects.error}
        </div>
      )}
      <MainBar
        openFiles={openFiles}
        logs={logs}
        onLogs={setLogs}
        scm={scm}
        onScm={setScm}
      />

      <MainView
        logs={logs}
        scm={scm}
        scmView={scmView}
        git={git}
        gitActions={gitActions}
        gitBulk={gitBulk}
        projectId={projects.activeId}
        toasts={toasts}
        openFiles={openFiles}
        gesture={gesture}
        slice={sessions.active}
        scrollRef={scrollRef}
      />

      <AppDialogs
        palette={palette}
        onClosePalette={() => setPalette(null)}
        onOpenFile={openFiles.open}
        settingsOpen={settings && activeProject !== null}
        testingOpen={testing && activeProject !== null}
        {...(activeProject ? { project: activeProject } : {})}
        theme={theme}
        mcp={mcp}
        mcpOpen={mcpOpen && activeProject !== null}
        onCloseMcp={() => setMcpOpen(false)}
        appSettings={appSettings}
        {...(activeProject ? { status: statusOf(activeProject.id) } : {})}
        {...(session?.handshake.failure ? { failure: session.handshake.failure.reason } : {})}
        onCloseSettings={() => setSettings(false)}
        onCloseTesting={() => setTesting(false)}
      />

      {/* 질문·계획도 승인처럼 큐 — 맨 앞 하나만 내려보내고, 답하면 다음이 나온다 */}
      <InterruptCards approvals={approvals} question={questions[0] ?? null} plan={plans[0] ?? null} resolve={sessions} />

      {/* 소스 관리 탭에서는 감춘다 — 언마운트하지 않는다 (쓰던 글이 사라진다, useScmView) */}
      <ChatComposer
        hidden={hidesComposer(openFiles.active)}
        ready={ready}
        isStreaming={isStreaming}
        permissionMode={permissionMode}
        workingDir={workingDir}
        onPermissionMode={(mode: PermissionMode) => {
          sessions.setPermissionMode(mode)
          void window.davis.setPermissionMode({ mode })
        }}
        attachments={attachments}
        insert={insert}
        project={activeProject}
        activeTab={openFiles.active}
        chatContext={openFiles.chatContext}
        onSelectTab={openFiles.select}
        onConnectors={() => setMcpOpen(true)}
        onDevPhrase={devPhrase}
        chatId={history.current?.chatId ?? null}
        onToast={toasts.show}
        turnMetas={snapshot.turnMetas}
      />
      </div>
      </div>

      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  )
}
