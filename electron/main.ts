import { app, BrowserWindow, ipcMain, powerMonitor, protocol } from 'electron'
import { installAppMenu } from './appMenu'
import * as path from 'node:path'
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
import { captureConsole, logStore } from './logs/logStore'
import { OpencodeServerPool } from './opencode/serverPool'
import { ServerPidStore } from './opencode/pidStore'
import { installQuitGuard } from './app/quitGuard'
import { applyDockIcon } from './app/dockIcon'
import type { ExtensionService } from './extensions/service'
import { launchExtensionHost } from './extensions/appLaunch'
import { ExtensionViewHost, VIEW_SCHEME } from './extensions/viewHost'
import type { DesktopMcp } from './mcp/desktopMcp'
import { createDesktopMcp } from './mcp/appWiring'
import { PtyDrawerBridge } from './pty/drawerBridge'

// 확장 화면을 서빙할 스킴. **app ready 전에** 등록해야 한다 (Electron 규칙) —
// 그래서 이 한 줄만 모듈 최상위에 있다. 이유는 `viewHost.ts` 머리말.
// standard: URL 에 host(`view`)를 두려면 필요하다. secure: 안 주면 프레임이 비보안으로 막힌다.
protocol.registerSchemesAsPrivileged([
  { scheme: VIEW_SCHEME, privileges: { standard: true, secure: true } },
])

const extensionViews = new ExtensionViewHost()

/**
 * 우리가 띄운 서버의 흔적. **훅이 안 도는 종료(SIGKILL·크래시·전원 차단)의 그물이다** —
 * 왜 이 방법인지(그리고 stdin 을 물리는 방법이 왜 안 되는지)는 `opencode/pidStore.ts` 머리말.
 *
 * `app.getPath('userData')` 는 ready 이전에도 답한다 (앱 이름에서 유도되는 값이라 그렇다).
 * 여기서 잡아 두는 이유는 아래 풀이 모듈 수명이기 때문이다.
 */
const serverPids = new ServerPidStore(path.join(app.getPath('userData'), 'opencode-servers.json'))

/**
 * 프로젝트마다 하나씩 띄우는 opencode 서버 (`opencode/serverPool.ts`).
 *
 * **앱 수명이다.** 창 수명(SessionBridge)에 매달면 macOS 에서 창을 닫았다 되살릴 때마다
 * 서버가 통째로 새로 뜬다. 회수는 창이 사라질 때(`window-all-closed` → `bridge.dispose`)와
 * 앱이 끝날 때 두 곳에서 한다 — 둘 다 **표에 있는 자식만** 죽인다.
 */
const opencodeServers = new OpencodeServerPool({
  pids: serverPids,
  log: (line) => logStore.add('desktop', line),
})

// vite dev 서버를 쓸 때만 설정된다. 없으면 빌드 산출물을 로드한다.
const DEV_SERVER_URL = process.env['DAVIS_DEV_SERVER_URL']

let bridge: SessionBridge | null = null
let projects: ProjectBridge | null = null
let logs: LogBridge | null = null
/** 하단 셸 드로어. 창에 매인다 (webContents.send) */
let drawer: PtyDrawerBridge | null = null
let git: GitBridge | null = null
let extensions: ExtensionService | null = null
// 브리지는 창에 매인다(webContents.send). 호스트(앱 수명)와 수명이 달라 정리 시점도 다르다.
let extensionIpc: ExtensionBridge | null = null
// 확장은 앱 수명(창보다 먼저 뜬다)이라 레지스트리 인스턴스를 들고 있을 수 없다. 여기로 조회한다.
let projectRegistry: ProjectRegistry | null = null
/** 확장 호스트가 "꺼 둔 확장" 을 물어보는 곳. 호스트는 창보다 오래 살아 여기 둔다. */
let appSettings: SettingsStore | null = null
/** 에이전트가 이 앱을 조작하는 문 (`electron/mcp/`). 창이 다시 만들어져도 포트는 하나다. */
let desktopMcp: DesktopMcp | null = null
/**
 * 지금 창. **DesktopMcp 가 창보다 오래 살기 때문에 여기 둔다.**
 *
 * macOS 는 창을 다 닫아도 앱이 죽지 않고(`window-all-closed`), 독에서 되살리면
 * `createWindow()` 가 **새 window·새 registry** 를 만든다. `desktopMcp` 는 `??=` 라
 * 첫 것을 그대로 들고 있으므로, 클로저로 굳히면 파괴된 창을 영영 바라본다 —
 * 에이전트에게는 "화면이 없어 파일을 열지 못했습니다" 만 돌아간다.
 * 확장 호스트가 `activeFile` 을 함수로 받아 가는 것과 같은 이유다.
 */
let mainWindow: BrowserWindow | null = null

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
  mainWindow = window
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
  // opencode 서버도 프로젝트마다 하나이고 **우리가 띄운다** (`opencode/serverPool.ts`).
  // 에이전트가 이 앱을 조작하는 문. **창마다 새로 만들지 않는다** — 포트와 토큰이 둘이 되면
  // opencode 에 등록된 옛 주소가 죽는다. 포트들이 왜 함수인지는 `mcp/appWiring.ts` 머리말.
  desktopMcp ??= createDesktopMcp({
    settings: () => (appSettings ?? settings).load(), // 모듈 변수 — 지역을 잡으면 첫 창 세대에 굳는다 (A7)
    registry: () => projectRegistry,
    window: () => mainWindow,
    // 아래에서 만들어진다 — 여기서 값을 잡지 않는 이유가 그것만은 아니다 (창 수명, 머리말)
    ptyDrawer: () => drawer,
    // 등록은 **그 프로젝트의 서버**에 한다 — 여기가 갈리는 것이 격리의 전부다
    serverUrl: (projectId) => opencodeServers.urlOf(projectId),
  })
  const mcp = desktopMcp
  bridge = new SessionBridge(
    window,
    opencodeServers,
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
      // 탭을 닫으면 그 프로젝트의 셸도 거둔다 — 안 그러면 서버에 죽은 셸이 쌓인다
      onClose: (id) => {
        void bridge?.closeProject(id)
        void drawer?.closeProject(id)
      },
      onReconnect: (project) => bridge?.reconnect(project) ?? Promise.resolve(),
      onRestartRuntime: (open) => bridge?.restartRuntime(open) ?? Promise.resolve(),
      // 진단·설정 조회는 **활성 프로젝트의 서버**에 묻는다. 없으면 null 이고, 그 자리는
      // "아직 안 뜬 것" 과 "못 띄운 것" 을 구별하지 않는다 — 둘 다 물을 곳이 없다.
      activeServerUrl: () => opencodeServers.urlOf(registry.active?.id),
      // 「다시 시작」·「서버 시작」이 여기서 갈리고, Doctor 사다리 ②의 갈래도 같은 값을 쓴다
      serverStatus: () => opencodeServers.statusOf(registry.active?.id),
      // 사용자가 「연결」 팝업에서 직접 시작·다시 시작·종료한다 (설계 2026-08-14)
      onServerControl: async (action) => {
        const active = registry.active
        if (active === null || bridge === null) return
        await bridge.controlServer(action, active)
      },
    },
    settings,
  )
  projects.register()

  // 셸 드로어(⌘↓/⌘↑). 셸은 opencode 서버가 굴리므로 여기는 배선뿐이다.
  drawer = new PtyDrawerBridge({
    window,
    // 드로어는 **앞에 나와 있는 프로젝트의 것**이다 (`drawerBridge.ts` 머리말)
    activeProject: () => {
      const active = registry.active
      return active === null ? null : { id: active.id, root: active.root }
    },
    // 드로어의 pty 도 그 프로젝트의 서버가 굴린다 — 활성 프로젝트를 따라간다
    opencodeUrl: () => opencodeServers.urlOf(registry.active?.id),
  })
  drawer.register()

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
      // 확장 화면의 「중단」 — 이제 끊을 것은 **사용자 대화의 턴**이다 (설계 2026-08-13).
      // 곁길 소켓이 없어져 끊을 다른 것이 없다.
      cancel: (projectId: string | null) => bridge?.cancelTurn(projectId),
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

void app.whenReady().then(async () => {
  // 창을 만들기 전에 건다 — 기동 중에 찍히는 것이 로그의 앞부분이라 놓치면 안 된다
  captureConsole()
  // 지난 실행이 곱게 못 끝났으면(강제 종료·크래시) 그때 띄운 서버가 남아 있다.
  // **적어 둔 PID 만** 본다 — 명령줄까지 대조해 남의 프로세스는 손대지 않는다 (`pidStore.ts`).
  serverPids.reap((line) => logStore.add('desktop', line))
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
  // 창 수명 물건들은 **함수로** 넘긴다 — 호스트는 앱 수명이라 굳히면 죽은 세대를 본다
  extensions = launchExtensionHost({
    registry: () => projectRegistry,
    askViaChat: (projectId, prompt) => bridge?.ask(projectId, prompt) ?? null,
    activeFile: () => extensionIpc?.currentActiveFile() ?? null,
    askText: (options) => extensionIpc?.askText(options) ?? null,
    settings: () => appSettings,
  })
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })

  // 절전에서 깨어나면 살아 있다고 믿던 소켓을 먼저 버린다 (sessionWake.ts 에 근거).
  // 이걸 안 하면 상대가 닫아줄 때까지, 최악의 경우 자체 와치독 90초까지 기다린다.
  powerMonitor.on('resume', () => bridge?.wakeAll())
})

app.on('window-all-closed', () => {
  // 우리가 띄운 서버를 정리하고 나서 종료한다 (`bridge.dispose` 가 풀까지 거둔다).
  // macOS 는 여기서 앱이 안 죽는다 — 독에서 되살리면 서버도 다시 뜬다.
  ipcMain.removeAllListeners(Channel.NOTIFY_TASK_DONE)
  projects?.dispose()
  projects = null
  logs?.dispose()
  logs = null
  // 창이 사라지면 드로어도 없다. 서버 쪽 pty 는 그대로 둔다 — 창을 다시 만들면 되찾는다.
  void drawer?.dispose()
  drawer = null
  mainWindow = null
  // MCP 서버는 계속 듣는다 (포트·토큰이 바뀌면 opencode 쪽 등록이 죽는다).
  // 등록 표시만 비워, 창을 되살렸을 때 다시 등록되게 한다.
  desktopMcp?.forgetRegistrations()
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

// 앱이 완전히 종료되기 전에 정리한다 (⌘Q 등). **끝날 때까지 붙잡는다** —
// 이제 거둘 것에 자식 프로세스가 있어 흘려보내면 서버가 남는다 (`app/quitGuard.ts`).
// 「종료 시 유예 없음(§2-6 J)」이 여기서는 풀렸다. 확장 호스트 쪽은 그대로 미결이다.
installQuitGuard(async () => {
  // 세션 + 우리가 띄운 opencode 서버 전부
  await bridge?.dispose()
  // 확장 호스트는 앱 수명이라 여기 한 곳에서만 거둔다
  extensions?.dispose()
  extensions = null
  // 듣던 포트를 닫는다. opencode 쪽 등록은 우리가 지우지 않아도 instance 와 함께 사라진다.
  await desktopMcp?.dispose()
  desktopMcp = null
})
