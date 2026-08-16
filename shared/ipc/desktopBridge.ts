import type { AppSettings } from '../settings/appSettings'
import type {
  ServerPingResultPayload,
  ApprovalRespondPayload,
  QuestionRespondPayload,
  PlanRespondPayload,
  ChatSendPayload,
  LocalNoticePayload,
  TaskNoticePayload,
  ChatSnapshotPayload,
  DesktopMcpOpenFilePayload,
  ExtensionChatAskPayload,
  DiagnosticsPayload,
  FileListPayload,
  HistoryIdPayload,
  HistoryRenamePayload,
  HistoryStatePayload,
  ModelCheckResultPayload,
  ServerControlPayload,
  ServerControlResultPayload,
  ServerStatusPayload,
  PermissionModePayload,
  WorkingDirPayload,
  PickedAttachment,
  PtyDataPayload,
  PtyDetachPayload,
  PtyExitPayload,
  PtyInputPayload,
  PtyOpenResult,
  PtyResizePayload,
  ProjectFavoritePayload,
  ProjectIdPayload,
  ProjectOpenPayload,
  ProjectOpenResultPayload,
  ProjectRenamePayload,
  ProjectStatePayload,
  ReadDirPayload,
  ReadDirResultPayload,
  ReadFilePayload,
  ReadFileResultPayload,
  OpenInOsPayload,
  OpenInOsResultPayload,
  WriteFilePayload,
  WriteFileResultPayload,
  ReviewDecidePayload,
  ReviewStatePayload,
  SearchPayload,
  SearchResultPayload,
  SessionStatePayload,
  CommandListPayload,
  OpencodeConfigPayload,
  OpencodeConfigWritePayload,
  TurnEvent,
} from './channels'
import type { McpState } from '../protocol/mcpConfig'
import type { LlmModelStatePayload } from '../protocol/llmConfig'
import type { UserNotification } from '../protocol/notification'
import type { LogEntry, LogListResult } from './logPayloads'
import type {
  GitActionResult,
  GitCommitPayload,
  GitDiffPayload,
  GitDiffResultPayload,
  GitHunkPayload,
  GitPathPayload,
  GitProjectPayload,
  GitPushPayload,
  GitStatePayload,
} from './gitPayloads'
import type { ExtensionRegistryBridge } from './extensionRegistryBridge'
import type { ExtensionBridgeSurface } from './extensionBridgeSurface'
import type { GitHistoryBridge } from './gitHistoryBridge'

// preload 가 renderer 에 노출하는 표면.
// channels.ts 가 300줄을 넘어 갈라냈다 — 채널 정의와 함께 자랄 이유가 없다.

/**
 * main → renderer 구독 콜백.
 *
 * `projectId` 는 둘째 인자로 준다. 안 쓰는 쪽은 받지 않아도 타입이 맞으므로
 * 프로젝트를 신경 쓰지 않는 화면은 그대로 둘 수 있다.
 */
export type ProjectHandler<T> = (payload: T, projectId: string) => void

/**
 * preload 가 renderer 에 노출하는 표면. renderer 는 이 타입만 안다.
 *
 * 히스토리·브랜치·임시저장은 `gitHistoryBridge.ts` 로 갈라 두고 상속한다 —
 * 이 파일이 300줄 상한에 붙어서다. **renderer 쪽 쓰임은 그대로 `window.davis.*`.**
 */
export interface DesktopBridge extends GitHistoryBridge, ExtensionRegistryBridge, ExtensionBridgeSurface {
  startSession(): Promise<void>
  sendChat(payload: ChatSendPayload): Promise<void>
  cancelChat(): Promise<void>
  resetChat(): Promise<void>
  /** 로컬 안내 한 쌍을 대화에 남긴다 (이스터에그 등 — runtime 을 거치지 않는다) */
  chatLocalNotice(payload: LocalNoticePayload): Promise<void>
  /** 현재 대화 제목을 바꾼다 (/rename). 빈 제목이면 무시된다. */
  renameCurrentChat(title: string): Promise<void>
  respondApproval(payload: ApprovalRespondPayload): Promise<void>
  /** ask_user 질문에 답한다. answer=null 은 취소 */
  respondQuestion(payload: QuestionRespondPayload): Promise<void>
  /** 계획 승인/거부에 답한다 */
  respondPlan(payload: PlanRespondPayload): Promise<void>
  onSessionState(handler: ProjectHandler<SessionStatePayload>): () => void
  onTurnEvent(handler: ProjectHandler<TurnEvent>): () => void
  onChatSnapshot(handler: ProjectHandler<ChatSnapshotPayload>): () => void
  setPermissionMode(payload: PermissionModePayload): Promise<void>
  onPermissionMode(handler: ProjectHandler<PermissionModePayload>): () => void
  /** 현재 세션 작업 경로 push (ADR-036) */
  onWorkingDir(handler: ProjectHandler<WorkingDirPayload>): () => void
  requestHistoryList(): Promise<void>
  loadHistory(payload: HistoryIdPayload): Promise<void>
  removeHistory(payload: HistoryIdPayload): Promise<void>
  renameHistory(payload: HistoryRenamePayload): Promise<void>
  onHistoryState(handler: ProjectHandler<HistoryStatePayload>): () => void
  decideReview(payload: ReviewDecidePayload): Promise<void>
  onReviewState(handler: ProjectHandler<ReviewStatePayload>): () => void
  /** 폴더 선택 대화상자를 띄우고 고른 것을 연다. 취소하면 ok:false 에 message 없음. */
  pickProject(): Promise<ProjectOpenResultPayload>
  openProject(payload: ProjectOpenPayload): Promise<ProjectOpenResultPayload>
  closeProject(payload: ProjectIdPayload): Promise<void>
  activateProject(payload: ProjectIdPayload): Promise<void>
  renameProject(payload: ProjectRenamePayload): Promise<void>
  favoriteProject(payload: ProjectFavoritePayload): Promise<void>
  /** 라이선스를 바꾸면 그 프로젝트 세션이 다시 붙는다 */
  onProjectState(handler: (payload: ProjectStatePayload) => void): () => void
  /**
   * 현재 목록을 직접 가져온다.
   *
   * 구독만으로는 화면이 붙기 전에 밀려온 상태를 놓친다 —
   * 그러면 프로젝트가 열려 있는데도 런처가 뜬다.
   */
  listProjects(): Promise<ProjectStatePayload>
  readDir(payload: ReadDirPayload): Promise<ReadDirResultPayload>
  readFile(payload: ReadFilePayload): Promise<ReadFileResultPayload>
  /** OS 로 연다 — 기본 앱(external) 또는 Finder(reveal). PDF·이미지·압축 파일용. */
  openInOs(payload: OpenInOsPayload): Promise<OpenInOsResultPayload>
  /** 덮어쓴다. 연 뒤에 바뀌었으면 거절한다 (에이전트가 고쳤을 수 있다). */
  writeFile(payload: WriteFilePayload): Promise<WriteFileResultPayload>
  /** 활성 프로젝트의 연결을 지금 확인한다 */
  diagnose(): Promise<DiagnosticsPayload>
  getSettings(): Promise<AppSettings>
  /** 저장된(정규화된) 값을 돌려준다 — 화면이 그 값으로 다시 그린다 */
  setSettings(settings: AppSettings): Promise<AppSettings>
  /** 활성 프로젝트의 서버에 쓸 모델이 붙어 있는지 (진단 3단계) */
  checkModels(): Promise<ModelCheckResultPayload>
  /** desktop 이 **그 프로젝트의** opencode 서버에 직접 닿는지 확인한다 (진단 2단계) */
  pingServer(): Promise<ServerPingResultPayload>
  /** 이 프로젝트의 서버를 우리가 띄웠나 — 「다시 시작」과 「서버 시작」이 여기서 갈린다 */
  serverStatus(): Promise<ServerStatusPayload>
  /** 서버 시작·다시 시작·종료. 현장 사용자에게는 터미널이 없다 */
  controlServer(payload: ServerControlPayload): Promise<ServerControlResultPayload>
  /** 지금 프로젝트만 다시 붙는다. 서버는 살려 둔다 */
  reconnectProject(): Promise<void>
  /** 우리가 띄운 서버를 접고 다시 띄운 뒤 열려 있는 프로젝트를 전부 되살린다 */
  restartRuntime(): Promise<void>
  /** 붙일 것을 고른다. 이미지면 내용을, 그 밖이면 경로를 담아 온다. 취소하면 빈 배열. */
  pickAttachments(): Promise<PickedAttachment[]>
  /** 드래그드롭한 File 의 절대경로를 얻는다 (Electron 33 은 File.path 가 없다). 인자는 renderer 의 File. */
  pathForFile(file: unknown): string
  /** 드롭한 경로들을 판별해 붙일 것으로 바꾼다 (다이얼로그 없이). */
  resolveAttachments(paths: string[]): Promise<PickedAttachment[]>
  /** 창이 비활성일 때 OS 알림 (설정이 켜져 있으면). 비우면 작업 완료, kind 로 응답 대기 종류를 가른다. */
  notifyTaskDone(notice?: TaskNoticePayload): void
  /** `!명령` 을 프로젝트 폴더에서 실행한다. LLM 을 거치지 않는다. */
  runShell(payload: { command: string }): Promise<void>
  /** 활성 프로젝트의 파일 목록. 빠른 열기가 쓴다. */
  /** 라이선스·관리자 주소가 갖춰졌는지. 환경변수 폴백까지 본다. */
  /** 이 프로젝트의 `/` 목록. opencode 가 아는 명령·MCP·스킬이 한 배열로 온다. */
  listCommands(): Promise<CommandListPayload>
  /** opencode 자신의 설정 — 프로젝트 파일 원문과 서버가 합친 유효 설정 */
  readOpencodeConfig(): Promise<OpencodeConfigPayload>
  /** 그 설정 파일을 쓴다. 깨진 JSON 이면 파일을 건드리지 않고 사유만 돌아온다. */
  writeOpencodeConfig(payload: { path: string; content: string }): Promise<OpencodeConfigWritePayload>
  /** opencode instance 를 버려 설정을 다시 읽힌다. 이어서 이 프로젝트가 다시 붙는다. */
  reloadOpencodeConfig(): Promise<{ ok: boolean; error?: string }>
  /** 개인 MCP 자격. 값은 올려보내기만 하고 응답에는 오지 않는다. */
  requestMcpStatus(): Promise<void>
  setMcpCredentials(payload: {
    serverName: string
    credentials: Record<string, string>
    enabled: boolean
  }): Promise<void>
  testMcpCredentials(payload: {
    serverName: string
    credentials: Record<string, string>
  }): Promise<void>
  onMcpState(handler: ProjectHandler<McpState>): () => void
  /**
   * 데스크톱 MCP 서버의 `open_file` 도구가 파일을 열라고 했다 (`electron/mcp/`).
   * 위의 `*McpCredentials`·`onMcpState` 와 **다른 뜻의 MCP** 다 — `channelNames.ts` 참조.
   */
  onDesktopMcpOpenFile(handler: ProjectHandler<DesktopMcpOpenFilePayload>): () => void
  /**
   * 확장이 `chat.ask` 로 물었다 — **화면이 사용자 입력과 같은 큐에 넣어야 한다.**
   * main 이 직접 보내지 않는 이유는 그 큐가 렌더러에 있기 때문이다 (`useSendQueue`).
   */
  onExtensionChatAsk(handler: ProjectHandler<ExtensionChatAskPayload>): () => void
  /** 모델 스위처 상태를 다시 받아온다 (연결돼 있으면 push 로 돌아온다) */
  requestModelOptions(): Promise<void>
  /** 모델 스위처 상태 (llm_config status/models 결과, DC-1322) */
  onModelState(handler: ProjectHandler<LlmModelStatePayload>): () => void
  /** 피드백을 관리자 서버로 보낸다 */
  listFiles(): Promise<FileListPayload>
  /** 활성 프로젝트 안에서 문자열을 찾는다 */
  searchText(payload: SearchPayload): Promise<SearchResultPayload>
  listLogs(): Promise<LogListResult>
  clearLogs(): Promise<void>
  /** 로그는 프로젝트에 매이지 않아 겉봉이 없다 */
  onLogAppend(handler: (entry: LogEntry) => void): () => void
  /**
   * 하단 셸 드로어 (⌘↓/⌘↑). 셸은 **opencode 서버가 굴린다** (`/api/pty`).
   *
   * `runShell`(`!명령` 한 번 실행 → 대화에 결과를 남긴다)과 성격이 다르다 —
   * 이쪽은 살아 있는 셸에 붙어 바이트를 주고받는다.
   * 어느 프로젝트인지는 **main 이 활성 프로젝트로 푼다** (렌더러가 보내지 않는다).
   */
  openShellDrawer(): Promise<PtyOpenResult>
  /** 누른 키를 그대로. **응답을 기다리지 않는다** — 왕복을 기다리면 타이핑이 느려진다 */
  sendShellInput(payload: PtyInputPayload): void
  resizeShell(payload: PtyResizePayload): Promise<void>
  /**
   * 그 프로젝트의 드로어에서 손을 뗀다. **셸은 죽이지 않는다** — 다시 펴면 스크롤백째 돌아온다.
   * ⌘↑ 로 접을 때가 아니라 **프로젝트를 옮길 때** 부른다 (`PtyDetachPayload` 머리말).
   */
  detachShellDrawer(payload: PtyDetachPayload): void
  onShellData(handler: ProjectHandler<PtyDataPayload>): () => void
  onShellExit(handler: ProjectHandler<PtyExitPayload>): () => void
  /** 소스 관리 상태. 저장소가 아니면 isRepo: false 로 온다. */
  gitState(payload: GitProjectPayload): Promise<GitStatePayload>
  onGitState(handler: ProjectHandler<GitStatePayload>): () => void
  /** 공지 한 건이 런타임 WS 로 들어왔을 때 */
  /** 사용자 알림 한 건 (kind=notification). 공지와 달리 나에게만 온다 */
  onNotification(handler: ProjectHandler<UserNotification>): () => void
  /** 공지 게시판 창을 연다 (관리자 SPA /board) */
  /** 한 파일의 diff. staged 여부에 따라 다른 것을 묻는다. */
  gitFileDiff(payload: GitDiffPayload): Promise<GitDiffResultPayload>
  /** 인덱스에 담는다 / 뺀다 / 작업트리를 되돌린다. 뒤이어 새 상태가 밀려온다. */
  gitStage(payload: GitPathPayload): Promise<GitActionResult>
  gitUnstage(payload: GitPathPayload): Promise<GitActionResult>
  gitRevert(payload: GitPathPayload): Promise<GitActionResult>
  /**
   * diff 덩어리 하나만 인덱스에 담는다. 나머지 덩어리는 워킹트리에 그대로 남는다.
   * 뒤이어 새 상태가 밀려온다.
   *
   * ⚠ `hunkText` 는 **화면이 그린 덩어리 원문(머리+본문) 그대로** 보낸다. main 이 원문
   * diff 를 같은 함수로 갈라 글자 그대로 대조해 다르면 거절한다 — 배선 어디에서도
   * 손대지 않는다.
   * ⚠ `hunkIndex` 는 **담기 전 diff 기준**이다. 한 번 담으면 뒤 인덱스가 밀리므로
   * 다음 요청 전에 밀려온 상태로 diff 를 새로 받아야 한다.
   */
  gitStageHunk(payload: GitHunkPayload): Promise<GitActionResult>
  /**
   * diff 덩어리 하나만 워킹트리에서 되돌린다.
   *
   * ⚠ **되돌릴 수 없다** (`gitRevert` 와 같다). 부르는 쪽이 사용자에게 한 번 확인받은
   * 뒤에만 부른다 — 확인 절차는 `useGitActions` 가 입힌다.
   */
  gitRevertHunk(payload: GitHunkPayload): Promise<GitActionResult>
  /** 인덱스에 있는 것을 커밋한다 */
  gitCommit(payload: GitCommitPayload): Promise<GitActionResult>
  /** 올린다. 업스트림이 없으면 setUpstream 으로 만들며 올린다. */
  gitPush(payload: GitPushPayload): Promise<GitActionResult>
  gitPull(payload: GitProjectPayload): Promise<GitActionResult>
  /**
   * 변경사항을 전부 담는다 / 인덱스를 통째로 비운다. 뒤이어 새 상태가 밀려온다.
   *
   * ⚠ 커밋이 하나도 없는 저장소에서 `gitUnstageAll` 은 실패로 온다
   * (`could not resolve HEAD`, 실측). 첫 커밋 전에는 되돌릴 인덱스가 없다.
   */
  gitStageAll(payload: GitProjectPayload): Promise<GitActionResult>
  gitUnstageAll(payload: GitProjectPayload): Promise<GitActionResult>
  /**
   * 직전 커밋을 새 메시지로 다시 만든다.
   *
   * ⚠ **인덱스에 담긴 것이 같이 들어간다.** 메시지만 고치려던 사용자에게
   * 담아 둔 파일이 딸려 들어갈 수 있어 부르는 쪽이 한 번 확인받는다.
   */
  gitAmend(payload: GitCommitPayload): Promise<GitActionResult>
  /** 커밋만 무르고 변경은 **담긴 채로** 남긴다 (`--soft`). 커밋이 하나뿐이면 실패로 온다. */
  gitUndoCommit(payload: GitProjectPayload): Promise<GitActionResult>
  /** 원격을 확인하고 다시 읽는다 (fetch 동반). 결과는 밀려온다. */
  gitRefresh(payload: GitProjectPayload): Promise<void>
}

declare global {
  interface Window {
    davis: DesktopBridge
  }
}
