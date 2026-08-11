import { app, BrowserWindow, ipcMain, nativeImage, powerMonitor, protocol, utilityProcess } from 'electron'
import { installAppMenu } from './appMenu'
import * as path from 'node:path'
import { existsSync } from 'node:fs'
import { Channel, type TaskNoticePayload } from '../shared/ipc/channels'
import { showTaskDone } from './notify/taskNotifier'
import { SessionBridge } from './ipc/bridge'
import { ProjectBridge } from './ipc/projectBridge'
import { ProjectRegistry } from './projects/projectRegistry'
import { ProjectStore, defaultStorePath } from './projects/projectStore'
import { SettingsStore, defaultSettingsPath } from './settings/settingsStore'
import { LogBridge } from './ipc/logBridge'
import { GitBridge } from './ipc/gitBridge'
import { ExtensionBridge } from './ipc/extensionBridge'
import { captureConsole } from './logs/logStore'
import { type HostPortsResult } from './extensions/hostPorts'
import type { ExtensionService } from './extensions/service'
import { startExtensionHost } from './extensions/appHost'
import type { ExtensionAskText } from './extensions/serviceDispatch'
import { ExtensionViewHost, VIEW_SCHEME } from './extensions/viewHost'
import { DesktopMcp } from './mcp/desktopMcp'
import { toActiveFile } from './ipc/extensionActiveFile'
import { logStore } from './logs/logStore'

// 확장 화면을 서빙할 스킴. **app ready 전에** 등록해야 한다 (Electron 규칙) —
// 그래서 이 한 줄만 모듈 최상위에 있다. 이유는 `viewHost.ts` 머리말.
// standard: URL 에 host(`view`)를 두려면 필요하다. secure: 안 주면 프레임이 비보안으로 막힌다.
protocol.registerSchemesAsPrivileged([
  { scheme: VIEW_SCHEME, privileges: { standard: true, secure: true } },
])

const extensionViews = new ExtensionViewHost()

// vite dev 서버를 쓸 때만 설정된다. 없으면 빌드 산출물을 로드한다.
const DEV_SERVER_URL = process.env['DAVIS_DEV_SERVER_URL']

let bridge: SessionBridge | null = null
let projects: ProjectBridge | null = null
let logs: LogBridge | null = null
let git: GitBridge | null = null
let extensions: ExtensionService | null = null
/** 확장이 앱에 닿는 포트들. `cancel` 을 확장 브리지도 써서 서비스 밖에 둔다 */
let extensionPorts: HostPortsResult | null = null
// 브리지는 창에 매인다(webContents.send). 호스트(앱 수명)와 수명이 달라 정리 시점도 다르다.
let extensionIpc: ExtensionBridge | null = null
// 확장은 앱 수명(창보다 먼저 뜬다)이라 레지스트리 인스턴스를 들고 있을 수 없다. 여기로 조회한다.
let projectRegistry: ProjectRegistry | null = null
/** 확장 호스트가 "꺼 둔 확장" 을 물어보는 곳. 호스트는 창보다 오래 살아 여기 둔다. */
let appSettings: SettingsStore | null = null
/** 에이전트가 이 앱을 조작하는 문 (`electron/mcp/`). 창이 다시 만들어져도 포트는 하나다. */
let desktopMcp: DesktopMcp | null = null

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1100,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const userData = app.getPath('userData')
  const registry = new ProjectRegistry({ store: new ProjectStore(defaultStorePath(userData)) })
  projectRegistry = registry
  const settings = new SettingsStore(defaultSettingsPath(userData))
  appSettings = settings

  // 창이 비활성일 때 작업 완료 알림 (renderer 가 비활성 여부를 판정해 send 한다).
  // activate 로 창이 다시 만들어질 수 있어 이전 리스너를 지운 뒤 건다 (중복 알림 방지).
  ipcMain.removeAllListeners(Channel.NOTIFY_TASK_DONE)
  ipcMain.on(Channel.NOTIFY_TASK_DONE, async (_event, notice?: TaskNoticePayload) => {
    if (!(await settings.load()).taskDoneNotify) return
    // 이름은 **그 턴의 프로젝트**로 찾는다. 활성 프로젝트를 쓰면 배경에서 끝난 작업에
    // 지금 보고 있는 프로젝트 이름이 찍힌다 (가이드 검토에서 드러남).
    const source = notice?.projectId
      ? registry.all.find((project) => project.id === notice.projectId)
      : registry.active
    showTaskDone(window, { ...notice, ...(source ? { project: source.name } : {}) })
  })

  // 세션은 프로젝트마다 하나다. 목록이 세션 수명을 이끈다 (설계 §3).
  // opencode 서버는 사용자가 띄운 것에 붙기만 한다 — 주소가 설정의 전부다.
  const stored = await settings.load()
  // 에이전트가 이 앱을 조작하는 문. 창마다 새로 만들지 않는다 — 포트와 토큰이 둘이 되면
  // opencode 에 등록된 옛 주소가 죽는다 (`electron/mcp/desktopMcp.ts`).
  desktopMcp ??= new DesktopMcp({
    settings: async () => {
      const current = await settings.load()
      return { desktopMcp: current.desktopMcp, opencodeUrl: current.opencodeUrl }
    },
    ports: {
      // **열린 프로젝트만** 안다. 탭을 닫으면 그 순간 아무 파일도 못 건드린다.
      rootOf: (id) => registry.openProjects.find((project) => project.id === id)?.root ?? null,
      focusedProjectId: () => registry.active?.id ?? null,
      // 값의 주인은 렌더러다 — main 이 짐작하지 않는다 (`extensionActiveFile.ts` 머리말).
      // 브리지는 창과 함께 생기므로 값이 아니라 함수로 읽는다.
      activeFile: () => toActiveFile(extensionIpc?.currentActiveFile() ?? null),
      // 겉봉(ProjectScoped)을 씌워 보낸다 — 화면은 지금 보고 있는 프로젝트 것만 받는다
      openInView: (projectId, target) => {
        if (window.isDestroyed()) return false
        window.webContents.send(Channel.DESKTOP_MCP_OPEN_FILE, { projectId, payload: target })
        return true
      },
    },
    log: (line) => logStore.add('desktop', line),
  })
  const mcp = desktopMcp
  bridge = new SessionBridge(
    window,
    { opencodeUrl: stored.opencodeUrl },
    {
      // opencode 의 MCP 등록은 instance 수명이라 **붙을 때마다** 다시 해야 한다
      onSessionReady: (project) => void mcp.onProjectReady(project),
      onSessionLost: (id) => mcp.onProjectLost(id),
    },
  )
  bridge.register()

  projects = new ProjectBridge(
    window,
    registry,
    {
      onActivate: (project) => void bridge?.activate(project),
      onClose: (id) => void bridge?.closeProject(id),
      onReconnect: (project) => bridge?.reconnect(project) ?? Promise.resolve(),
      onRestartRuntime: (open) => bridge?.restartRuntime(open) ?? Promise.resolve(),
      onRuntimeConfigChange: (runtime, open) =>
        bridge?.applyRuntimeConfig({ opencodeUrl: runtime.opencodeUrl }, open) ?? Promise.resolve(),
    },
    settings,
  )
  projects.register()

  logs = new LogBridge()
  logs.register()

  git = new GitBridge(window, registry)
  git.register()


  if (extensions) {
    // 배포처 주소는 settings.json 에 산다. 여기 있는 인스턴스를 그대로 넘긴다 —
    // 새로 만들면 캐시가 갈려 설정 화면이 저장한 값과 어긋난다
    extensionIpc = new ExtensionBridge({
      window,
      service: extensions,
      views: extensionViews,
      activeProjectId: () => registry.active?.id ?? null,
      // 중단은 **어시스턴트 소켓을 쥔 쪽**만 할 수 있다 (`hostPorts` 의 CancelBook)
      ...(extensionPorts ? { cancel: extensionPorts.cancel } : {}),
      settings,
    })
    extensionIpc.register()
  }

  // 화면은 IPC 핸들러가 다 붙은 뒤에 로드한다 —
  // 먼저 띄우면 renderer 의 첫 호출이 거부된다.
  await registry.restore()

  window.once('ready-to-show', () => {
    window.show()
    projects?.pushState()
    // 복원된 활성 프로젝트의 세션을 띄운다
    projects?.activateCurrent()
  })

  if (DEV_SERVER_URL) {
    await window.loadURL(DEV_SERVER_URL)
  } else {
    await window.loadFile(path.join(__dirname, '../../dist/index.html'))
  }
}

/**
 * 독 아이콘을 브랜드 것으로 바꾼다 (dev 한정).
 *
 * 패키징하면 electron-builder 가 build/icon.icns 를 심지만, 개발 중 `electron .`
 * 로 띄우면 기본 원자 아이콘이 뜬다. macOS 에서만 dock 이 있다.
 */
function applyDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  const iconPath = path.join(__dirname, '../../build/icon.png')
  if (!existsSync(iconPath)) return
  const image = nativeImage.createFromPath(iconPath)
  if (!image.isEmpty()) app.dock.setIcon(image)
}

/** 확장 호스트 기동. 판단은 전부 `extensions/appHost.ts` 에 있고 여기서는 앱 상태만 잇는다. */
function launchExtensionHost(): void {
  const started = startExtensionHost({
    userDataDir: app.getPath('userData'),
    entryPath: path.join(__dirname, 'extensions', 'hostEntry.js'),
    // 실제 utilityProcess 결선은 이 한 줄뿐이다 — host.ts 는 fork 를 주입받아
    // vitest(node 환경, electron 이 가짜)에서도 그대로 돈다.
    fork: (modulePath, args, options) => utilityProcess.fork(modulePath, args, options),
    registry: () => projectRegistry,
    laneFor: (projectId) => bridge?.laneFor(projectId) ?? null,
    // 보고 있는 파일은 **브리지**가 쥔다. 브리지는 창과 함께 생기고 이 호스트는 앱과 함께
    // 뜨므로, 값이 아니라 함수로 넘긴다 — 여기서 굳히면 늘 「없음」이다.
    activeFile: () => extensionIpc?.currentActiveFile() ?? null,
    // 물음창도 브리지(=창)가 쥔다. 창이 없으면 물을 곳이 없으니 사유와 함께 거절한다 —
    // 조용히 취소로 눙치면 확장은 사람이 닫은 줄 알고 아무 말도 하지 않는다.
    askText: (options: Parameters<ExtensionAskText>[0]) =>
      extensionIpc === null || extensionIpc === undefined
        ? Promise.reject(new Error('물어볼 창이 없습니다'))
        : extensionIpc.askText(options),
    // 호스트가 설정보다 먼저 뜰 수 있어 없으면 빈 목록으로 둔다 (전부 켜진 상태).
    disabledNames: async () => (await appSettings?.load())?.disabledExtensions ?? [],
    log: (line) => console.log(line),
  })
  extensions = started.service
  extensionPorts = started.ports
}

void app.whenReady().then(async () => {
  // 창을 만들기 전에 건다 — 기동 중에 찍히는 것이 로그의 앞부분이라 놓치면 안 된다
  captureConsole()
  // 기본 메뉴의 Close Window(⌘W)가 renderer 의 탭 닫기를 가로채지 않게 커스텀 메뉴를 세운다
  installAppMenu()
  applyDockIcon()
  // 확장 화면 서빙. 창보다 먼저 걸어야 한다 — 창이 뜨자마자 확장 탭이 복원될 수 있다.
  protocol.handle(VIEW_SCHEME, (request) => {
    const served = extensionViews.handle(request.url)
    return new Response(served.body, {
      status: served.status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  })
  launchExtensionHost()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })

  // 절전에서 깨어나면 살아 있다고 믿던 소켓을 먼저 버린다 (sessionWake.ts 에 근거).
  // 이걸 안 하면 상대가 닫아줄 때까지, 최악의 경우 자체 와치독 90초까지 기다린다.
  powerMonitor.on('resume', () => bridge?.wakeAll())
})

app.on('window-all-closed', () => {
  // 우리가 띄운 runtime 을 정리하고 나서 종료한다
  ipcMain.removeAllListeners(Channel.NOTIFY_TASK_DONE)
  projects?.dispose()
  projects = null
  logs?.dispose()
  logs = null
  git?.dispose()
  git = null
  // 창이 다시 만들어지면 register() 가 다시 불린다 — 안 풀면 두 번째 등록에서 던진다
  extensionIpc?.dispose()
  extensionIpc = null
  void bridge?.dispose().finally(() => {
    bridge = null
    if (process.platform !== 'darwin') app.quit()
  })
})

// 앱이 완전히 종료되기 전에도 정리한다 (Cmd+Q 등)
app.on('before-quit', () => {
  void bridge?.dispose()
  // 확장 호스트는 앱 수명이라 여기 한 곳에서만 거둔다.
  // 유예 종료(stop())가 아니라 dispose() 인 이유: 이벤트 핸들러가 동기라 기다릴 수 없다
  // (기존 dispose 들도 `void` 로 흘린다). 종료 시 유예는 §2-6 J 로 미결이다.
  extensions?.dispose()
  extensions = null
  // 듣던 포트를 닫는다. opencode 쪽 등록은 우리가 지우지 않아도 instance 와 함께 사라진다.
  void desktopMcp?.dispose()
  desktopMcp = null
})
