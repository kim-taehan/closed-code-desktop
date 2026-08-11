import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  Channel,
  type ApprovalRespondPayload,
  type QuestionRespondPayload,
  type PlanRespondPayload,
  type ChatSendPayload,
  type LocalNoticePayload,
  type TaskNoticePayload,
  type ChatSnapshotPayload,
  type DesktopMcpOpenFilePayload,
  type PermissionModePayload,
  type WorkingDirPayload,
  type HistoryIdPayload,
  type HistoryRenamePayload,
  type HistoryStatePayload,
  type ReviewDecidePayload,
  type ReviewStatePayload,
  type DesktopBridge,
  type ExtensionInstallPayload,
  type ExtensionListPayload,
  type ExtensionExportCsvPayload,
  type ExtensionExportCsvResult,
  type ExtensionHtmlPayload,
  type ExtensionViewRegisterPayload,
  type ExtensionViewRegisterResult,
  type ExtensionReadmePayload,
  type ExtensionSetEnabledPayload,
  type ExtensionUninstallPayload,
  type ExtensionUninstallResult,
  type ExtensionReadmeResult,
  type ExtensionRowsPayload,
  type ExtensionProgressPayload,
  type ExtensionTreePayload,
  type ActiveFileNotice,
  type ExtensionRunCommandPayload,
  type RegistryAddPayload,
  type RegistryFetchPayload,
  type RegistryInstallPayload,
  type RegistryListPayload,
  type RegistryReadmePayload,
  type ProjectFavoritePayload,
  type ProjectHandler,
  type ExtensionAskTextPayload,
  type ExtensionAskTextResponsePayload,
  type ProjectIdPayload,
  type ProjectOpenPayload,
  type ProjectOpenResultPayload,
  type ProjectRenamePayload,
  type ProjectScoped,
  type ProjectStatePayload,
  type DiagnosticsPayload,
  type FileListPayload,
  type PickedAttachment,
  type SearchPayload,
  type SkillListPayload,
  type SearchResultPayload,
  type ReadDirPayload,
  type ReadFilePayload,
  type ReadFileResultPayload,
  type OpenInOsPayload,
  type OpenInOsResultPayload,
  type WriteFilePayload,
  type WriteFileResultPayload,
  type ReadDirResultPayload,
  type SessionStatePayload,
  type TurnEvent,
} from '../shared/ipc/channels'
import type { McpState } from '../shared/protocol/mcpConfig'
import type { LlmModelStatePayload } from '../shared/protocol/llmConfig'
import type { UserNotification } from '../shared/protocol/notification'
import type { AppSettings } from '../shared/settings/appSettings'
import type { LogEntry, LogListResult } from '../shared/ipc/logPayloads'
import { gitBridge } from './preloadGit'

// renderer 에 노출하는 표면. 채널 이름을 renderer 가 알 필요는 없다 (ISP).

// 겉봉(ProjectScoped)을 벗기는 유일한 지점.
// 화면은 payload 만 보고, 프로젝트가 필요한 곳만 둘째 인자를 받는다.
function subscribe<T>(channel: string, handler: ProjectHandler<T>): () => void {
  const listener = (_event: IpcRendererEvent, scoped: ProjectScoped<T>) =>
    handler(scoped.payload, scoped.projectId)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

// 프로젝트 목록은 **앱 단위**라 겉봉이 없다 — 어느 프로젝트 것인지 물을 대상이 아니다.
function subscribePlain<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const bridge: DesktopBridge = {
  startSession: () => ipcRenderer.invoke(Channel.SESSION_START) as Promise<void>,
  sendChat: (payload: ChatSendPayload) => ipcRenderer.invoke(Channel.CHAT_SEND, payload) as Promise<void>,
  cancelChat: () => ipcRenderer.invoke(Channel.CHAT_CANCEL) as Promise<void>,
  resetChat: () => ipcRenderer.invoke(Channel.CHAT_RESET) as Promise<void>,
  chatLocalNotice: (payload: LocalNoticePayload) =>
    ipcRenderer.invoke(Channel.CHAT_LOCAL_NOTICE, payload) as Promise<void>,
  renameCurrentChat: (title: string) =>
    ipcRenderer.invoke(Channel.CHAT_RENAME_CURRENT, { title }) as Promise<void>,
  respondApproval: (payload: ApprovalRespondPayload) =>
    ipcRenderer.invoke(Channel.APPROVAL_RESPOND, payload) as Promise<void>,
  respondQuestion: (payload: QuestionRespondPayload) =>
    ipcRenderer.invoke(Channel.QUESTION_RESPOND, payload) as Promise<void>,
  respondPlan: (payload: PlanRespondPayload) =>
    ipcRenderer.invoke(Channel.PLAN_RESPOND, payload) as Promise<void>,
  onSessionState: (handler: ProjectHandler<SessionStatePayload>) =>
    subscribe<SessionStatePayload>(Channel.SESSION_STATE, handler),
  onTurnEvent: (handler: ProjectHandler<TurnEvent>) => subscribe<TurnEvent>(Channel.TURN_EVENT, handler),
  onChatSnapshot: (handler: ProjectHandler<ChatSnapshotPayload>) =>
    subscribe<ChatSnapshotPayload>(Channel.CHAT_SNAPSHOT, handler),
  setPermissionMode: (payload: PermissionModePayload) =>
    ipcRenderer.invoke(Channel.PERMISSION_MODE_SET, payload) as Promise<void>,
  onPermissionMode: (handler: ProjectHandler<PermissionModePayload>) =>
    subscribe<PermissionModePayload>(Channel.PERMISSION_MODE_CHANGED, handler),
  onWorkingDir: (handler: ProjectHandler<WorkingDirPayload>) =>
    subscribe<WorkingDirPayload>(Channel.WORKING_DIR_CHANGED, handler),
  requestHistoryList: () => ipcRenderer.invoke(Channel.HISTORY_LIST) as Promise<void>,
  loadHistory: (payload: HistoryIdPayload) => ipcRenderer.invoke(Channel.HISTORY_LOAD, payload) as Promise<void>,
  removeHistory: (payload: HistoryIdPayload) => ipcRenderer.invoke(Channel.HISTORY_REMOVE, payload) as Promise<void>,
  renameHistory: (payload: HistoryRenamePayload) =>
    ipcRenderer.invoke(Channel.HISTORY_RENAME, payload) as Promise<void>,
  onHistoryState: (handler: ProjectHandler<HistoryStatePayload>) =>
    subscribe<HistoryStatePayload>(Channel.HISTORY_STATE, handler),
  decideReview: (payload: ReviewDecidePayload) =>
    ipcRenderer.invoke(Channel.REVIEW_DECIDE, payload) as Promise<void>,
  onReviewState: (handler: ProjectHandler<ReviewStatePayload>) =>
    subscribe<ReviewStatePayload>(Channel.REVIEW_STATE, handler),
  pickProject: () => ipcRenderer.invoke(Channel.PROJECT_PICK) as Promise<ProjectOpenResultPayload>,
  openProject: (payload: ProjectOpenPayload) =>
    ipcRenderer.invoke(Channel.PROJECT_OPEN, payload) as Promise<ProjectOpenResultPayload>,
  closeProject: (payload: ProjectIdPayload) =>
    ipcRenderer.invoke(Channel.PROJECT_CLOSE, payload) as Promise<void>,
  activateProject: (payload: ProjectIdPayload) =>
    ipcRenderer.invoke(Channel.PROJECT_ACTIVATE, payload) as Promise<void>,
  renameProject: (payload: ProjectRenamePayload) =>
    ipcRenderer.invoke(Channel.PROJECT_RENAME, payload) as Promise<void>,
  favoriteProject: (payload: ProjectFavoritePayload) =>
    ipcRenderer.invoke(Channel.PROJECT_FAVORITE, payload) as Promise<void>,
  onProjectState: (handler: (payload: ProjectStatePayload) => void) =>
    subscribePlain<ProjectStatePayload>(Channel.PROJECT_STATE, handler),
  listProjects: () => ipcRenderer.invoke(Channel.PROJECT_LIST) as Promise<ProjectStatePayload>,
  readDir: (payload: ReadDirPayload) =>
    ipcRenderer.invoke(Channel.PROJECT_READ_DIR, payload) as Promise<ReadDirResultPayload>,
  readFile: (payload: ReadFilePayload) =>
    ipcRenderer.invoke(Channel.PROJECT_READ_FILE, payload) as Promise<ReadFileResultPayload>,
  openInOs: (payload: OpenInOsPayload) =>
    ipcRenderer.invoke(Channel.PROJECT_OPEN_IN_OS, payload) as Promise<OpenInOsResultPayload>,
  writeFile: (payload: WriteFilePayload) =>
    ipcRenderer.invoke(Channel.PROJECT_WRITE_FILE, payload) as Promise<WriteFileResultPayload>,
  getSettings: () => ipcRenderer.invoke(Channel.SETTINGS_GET) as Promise<AppSettings>,
  setSettings: (settings: AppSettings) =>
    ipcRenderer.invoke(Channel.SETTINGS_SET, settings) as Promise<AppSettings>,
  checkModels: (payload: { opencodeUrl?: string }) =>
    ipcRenderer.invoke(Channel.MODEL_CHECK, payload) as Promise<{ ok: boolean; message: string }>,
  pingServer: (payload: { opencodeUrl?: string } = {}) =>
    ipcRenderer.invoke(Channel.SERVER_PING, payload) as Promise<{ ok: boolean; detail: string }>,
  reconnectProject: () => ipcRenderer.invoke(Channel.SESSION_RECONNECT) as Promise<void>,
  restartRuntime: () => ipcRenderer.invoke(Channel.RUNTIME_RESTART) as Promise<void>,
  listSkills: () => ipcRenderer.invoke(Channel.SKILL_LIST) as Promise<SkillListPayload>,
  requestMcpStatus: () => ipcRenderer.invoke(Channel.MCP_STATUS) as Promise<void>,
  setMcpCredentials: (payload: {
    serverName: string
    credentials: Record<string, string>
    enabled: boolean
  }) => ipcRenderer.invoke(Channel.MCP_SET, payload) as Promise<void>,
  testMcpCredentials: (payload: { serverName: string; credentials: Record<string, string> }) =>
    ipcRenderer.invoke(Channel.MCP_TEST, payload) as Promise<void>,
  onMcpState: (handler: ProjectHandler<McpState>) => subscribe<McpState>(Channel.MCP_STATE, handler),
  onDesktopMcpOpenFile: (handler: ProjectHandler<DesktopMcpOpenFilePayload>) =>
    subscribe<DesktopMcpOpenFilePayload>(Channel.DESKTOP_MCP_OPEN_FILE, handler),
  requestModelOptions: () => ipcRenderer.invoke(Channel.MODEL_OPTIONS_REQUEST) as Promise<void>,
  onModelState: (handler: ProjectHandler<LlmModelStatePayload>) =>
    subscribe<LlmModelStatePayload>(Channel.MODEL_STATE, handler),
  listFiles: () => ipcRenderer.invoke(Channel.PROJECT_LIST_FILES) as Promise<FileListPayload>,
  searchText: (payload: SearchPayload) =>
    ipcRenderer.invoke(Channel.PROJECT_SEARCH, payload) as Promise<SearchResultPayload>,
  runShell: (payload: { command: string }) =>
    ipcRenderer.invoke(Channel.SHELL_RUN, payload) as Promise<void>,
  pickAttachments: () => ipcRenderer.invoke(Channel.ATTACH_PICK) as Promise<PickedAttachment[]>,
  // Electron 33 은 File.path 를 없앴다 — webUtils 로 드롭한 파일의 절대경로를 얻는다
  pathForFile: (file: unknown) => webUtils.getPathForFile(file as never),
  resolveAttachments: (paths: string[]) =>
    ipcRenderer.invoke(Channel.ATTACH_RESOLVE, { paths }) as Promise<PickedAttachment[]>,
  notifyTaskDone: (notice?: TaskNoticePayload) => ipcRenderer.send(Channel.NOTIFY_TASK_DONE, notice),
  diagnose: () => ipcRenderer.invoke(Channel.SESSION_DIAGNOSE) as Promise<DiagnosticsPayload>,
  listLogs: () => ipcRenderer.invoke(Channel.LOG_LIST) as Promise<LogListResult>,
  clearLogs: () => ipcRenderer.invoke(Channel.LOG_CLEAR) as Promise<void>,
  onLogAppend: (handler: (entry: LogEntry) => void) =>
    subscribePlain<LogEntry>(Channel.LOG_APPEND, handler),
  // git 배선은 preloadGit.ts — 이름·형태 그대로 여기 합쳐진다
  ...gitBridge(subscribe),
  onNotification: (handler: ProjectHandler<UserNotification>) =>
    subscribe<UserNotification>(Channel.NOTIFICATION, handler),
  listExtensions: () =>
    ipcRenderer.invoke(Channel.EXTENSION_LIST) as Promise<ExtensionListPayload>,
  runExtensionCommand: (payload: ExtensionRunCommandPayload) =>
    ipcRenderer.invoke(Channel.EXTENSION_RUN_COMMAND, payload) as Promise<void>,
  redrawExtensionViews: () => ipcRenderer.invoke(Channel.EXTENSION_REDRAW) as Promise<void>,
  // **응답을 기다리지 않는다.** 파일을 옮길 때마다 도는 자리라, 왕복을 기다리면
  // 탭 전환이 확장의 느린 조회만큼 느려진다. 실패해도 편집기는 그대로 돌아야 한다.
  notifyActiveFile: (file: ActiveFileNotice | null) => ipcRenderer.send(Channel.EXTENSION_ACTIVE_FILE, file),
  cancelExtension: () => ipcRenderer.invoke(Channel.EXTENSION_CANCEL) as Promise<void>,
  onExtensionRows: (handler: ProjectHandler<ExtensionRowsPayload>) =>
    subscribe<ExtensionRowsPayload>(Channel.EXTENSION_ROWS, handler),
  onExtensionHtml: (handler: ProjectHandler<ExtensionHtmlPayload>) =>
    subscribe<ExtensionHtmlPayload>(Channel.EXTENSION_HTML, handler),
  onExtensionTree: (handler: ProjectHandler<ExtensionTreePayload>) =>
    subscribe<ExtensionTreePayload>(Channel.EXTENSION_TREE, handler),
  onExtensionProgress: (handler: ProjectHandler<ExtensionProgressPayload>) =>
    subscribe<ExtensionProgressPayload>(Channel.EXTENSION_PROGRESS, handler),
  // 겉봉 없는 밀어주기라 `subscribe` 를 쓰지 않는다 — 물음은 늘 지금 보는 화면에 뜬다
  onExtensionAskText: (handler: (payload: ExtensionAskTextPayload) => void) => {
    const listener = (_event: unknown, payload: ExtensionAskTextPayload) => handler(payload)
    ipcRenderer.on(Channel.EXTENSION_ASK_TEXT, listener)
    return () => ipcRenderer.removeListener(Channel.EXTENSION_ASK_TEXT, listener)
  },
  respondExtensionAskText: (payload: ExtensionAskTextResponsePayload) =>
    ipcRenderer.invoke(Channel.EXTENSION_ASK_TEXT_RESPOND, payload) as Promise<void>,
  registerExtensionView: (payload: ExtensionViewRegisterPayload) =>
    ipcRenderer.invoke(Channel.EXTENSION_VIEW_REGISTER, payload) as Promise<ExtensionViewRegisterResult>,
  readExtensionReadme: (payload: ExtensionReadmePayload) =>
    ipcRenderer.invoke(Channel.EXTENSION_README, payload) as Promise<ExtensionReadmeResult>,
  setExtensionEnabled: (payload: ExtensionSetEnabledPayload) =>
    ipcRenderer.invoke(Channel.EXTENSION_SET_ENABLED, payload) as Promise<void>,
  uninstallExtension: (payload: ExtensionUninstallPayload) =>
    ipcRenderer.invoke(Channel.EXTENSION_UNINSTALL, payload) as Promise<ExtensionUninstallResult>,
  exportExtensionCsv: (payload: ExtensionExportCsvPayload) =>
    ipcRenderer.invoke(Channel.EXTENSION_EXPORT_CSV, payload) as Promise<ExtensionExportCsvResult>,
  installExtensionFromDisk: () =>
    ipcRenderer.invoke(Channel.EXTENSION_INSTALL_FROM_DISK) as Promise<ExtensionInstallPayload>,
  listExtensionRegistries: () =>
    ipcRenderer.invoke(Channel.EXTENSION_REGISTRY_LIST) as Promise<RegistryListPayload>,
  addExtensionRegistry: (payload) =>
    ipcRenderer.invoke(Channel.EXTENSION_REGISTRY_ADD, payload) as Promise<RegistryAddPayload>,
  removeExtensionRegistry: (payload) =>
    ipcRenderer.invoke(Channel.EXTENSION_REGISTRY_REMOVE, payload) as Promise<RegistryListPayload>,
  fetchExtensionRegistry: (payload) =>
    ipcRenderer.invoke(Channel.EXTENSION_REGISTRY_FETCH, payload) as Promise<RegistryFetchPayload>,
  fetchExtensionRegistryReadme: (payload) =>
    ipcRenderer.invoke(
      Channel.EXTENSION_REGISTRY_README,
      payload,
    ) as Promise<RegistryReadmePayload>,
  installExtensionFromRegistry: (payload) =>
    ipcRenderer.invoke(
      Channel.EXTENSION_REGISTRY_INSTALL,
      payload,
    ) as Promise<RegistryInstallPayload>,
}

contextBridge.exposeInMainWorld('davis', bridge)
