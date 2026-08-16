import { dialog, ipcMain, type BrowserWindow } from 'electron'
import {
  Channel,
  type ProjectFavoritePayload,
  type ProjectIdPayload,
  type ProjectOpenPayload,
  type ProjectOpenResultPayload,
  type ProjectRenamePayload,
  type ProjectStatePayload,
} from '../../shared/ipc/channels'
import { registerFsHandlers } from './projectFsHandlers'
import { ProjectFs } from '../projects/projectFs'
import { pickAttachments, resolveAttachments } from '../projects/attachmentPicker'
import { listFiles, searchText } from '../projects/projectSearch'
import { checkModels, pingOpencode } from '../opencode/probe'
import { fetchCommands } from '../opencode/commandList'
import { disposeInstance, readOpencodeConfig, writeOpencodeConfig } from '../settings/opencodeConfig'
import type { SettingsStore } from '../settings/settingsStore'
import type { AppSettings } from '../../shared/settings/appSettings'
import type { ServerControlPayload, ServerStatusPayload } from '../../shared/ipc/diagnosticsTypes'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import type { ProjectRegistry } from '../projects/projectRegistry'

/** 목록 변화를 세션 쪽에 알린다. 목록이 세션 수명을 이끌고, 그 반대는 없다. */
export interface ProjectBridgeListener {
  onActivate(project: ProjectRecord): void
  onClose(id: string): void
  /**
   * 세션을 접었다 다시 붙인다.
   *
   * **Promise 를 반드시 돌려준다.** 재연결은 세션 종료 → 재생성 → 탐색 → 연결 →
   * 핸드셰이크(인증 최대 15초)까지라 즉시 끝나지 않는다. 안 기다리면 renderer 의
   * `await reconnectProject()` 가 곧바로 풀리고, 자가 진단이 3초만 재확인하다 실패해
   * **멀쩡히 살아 있는 런타임을 재시작한다** (사다리 다음 칸).
   */
  onReconnect(project: ProjectRecord): Promise<void>
  /** 우리가 띄운 서버를 접고 다시 띄운 뒤 열려 있는 프로젝트를 모두 되살린다 */
  onRestartRuntime(projects: ProjectRecord[]): Promise<void>
  /**
   * **지금 활성 프로젝트의** opencode 서버 주소. 아직 안 떴으면 null.
   *
   * 전역 설정 `opencodeUrl` 이 있던 자리다. 서버가 프로젝트마다 갈리면서 "앱이 붙는 주소"
   * 라는 것이 없어졌고, 여기서 묻는 것들(명령 목록·설정 읽기·프로브)은 전부
   * **활성 프로젝트 기준**이라 활성만 알면 된다. 띄우지는 않는다 — 진단 버튼이 서버를
   * 만들어 내면 안 된다 (`serverPool.urlOf` 주석).
   */
  activeServerUrl(): string | null
  /** 활성 프로젝트의 서버 상태. 「다시 시작」과 「서버 시작」이 여기서 갈린다 */
  serverStatus(): ServerStatusPayload
  /**
   * 활성 프로젝트의 서버를 시작·다시 시작·종료한다.
   *
   * 셋을 한 메서드로 받는 이유: 셋 다 **같은 대상(활성 프로젝트의 서버)** 에 대한 조작이고
   * 부르는 화면도 하나다. 나누면 배선이 셋이 되는데 갈라서 얻는 것이 없다.
   */
  onServerControl(action: 'start' | 'restart' | 'stop'): Promise<void>
}

// 프로젝트 목록 IPC 만 책임진다. 세션 배선은 SessionBridge 가 따로 한다.
//
// 나눠 둔 이유는 프로젝트 목록이 **앱 단위**이고 세션은 **프로젝트 단위**이기 때문이다.
// 한 클래스에 두면 P3 에서 세션이 여러 개가 될 때 다시 갈라야 한다.

const HANDLED_CHANNELS = [
  Channel.PROJECT_PICK,
  Channel.PROJECT_OPEN,
  Channel.PROJECT_CLOSE,
  Channel.PROJECT_ACTIVATE,
  Channel.PROJECT_RENAME,
  Channel.PROJECT_FAVORITE,
  Channel.PROJECT_READ_DIR,
  Channel.PROJECT_LIST,
  Channel.PROJECT_READ_FILE,
  Channel.PROJECT_OPEN_IN_OS,
  Channel.PROJECT_WRITE_FILE,
  Channel.SETTINGS_GET,
  Channel.SETTINGS_SET,
  Channel.MODEL_CHECK,
  Channel.SERVER_PING,
  Channel.SERVER_STATUS,
  Channel.SERVER_CONTROL,
  Channel.SESSION_RECONNECT,
  Channel.RUNTIME_RESTART,
  Channel.ATTACH_PICK,
  Channel.ATTACH_RESOLVE,
  Channel.PROJECT_LIST_FILES,
  Channel.PROJECT_SEARCH,
  Channel.COMMAND_LIST,
  Channel.OPENCODE_CONFIG_READ,
  Channel.OPENCODE_CONFIG_WRITE,
  Channel.OPENCODE_CONFIG_RELOAD,
]

export class ProjectBridge {
  constructor(
    private readonly window: BrowserWindow,
    private readonly registry: ProjectRegistry,
    private readonly listener: ProjectBridgeListener,
    private readonly settings: SettingsStore,
  ) {
    // fs 경계는 열린 프로젝트 목록을 근거로 삼는다 — 닫으면 그 순간 못 읽는다
    this.fs = new ProjectFs(registry)
  }

  private readonly fs: ProjectFs

  register(): void {
    ipcMain.handle(Channel.PROJECT_LIST, () => this.snapshot())
    ipcMain.handle(Channel.PROJECT_PICK, () => this.pick())
    ipcMain.handle(Channel.PROJECT_OPEN, (_event, payload: ProjectOpenPayload) =>
      this.open(payload.root),
    )
    ipcMain.handle(Channel.PROJECT_CLOSE, async (_event, payload: ProjectIdPayload) => {
      await this.registry.close(payload.id)
      this.listener.onClose(payload.id)
      this.pushState()
      // 닫으면서 활성이 옮겨갔을 수 있다 — 그쪽 세션을 띄운다
      this.activateCurrent()
    })
    ipcMain.handle(Channel.PROJECT_ACTIVATE, async (_event, payload: ProjectIdPayload) => {
      await this.registry.activate(payload.id)
      this.pushState()
      this.activateCurrent()
    })
    ipcMain.handle(Channel.PROJECT_RENAME, async (_event, payload: ProjectRenamePayload) => {
      await this.registry.rename(payload.id, payload.name)
      this.pushState()
    })
    ipcMain.handle(Channel.PROJECT_FAVORITE, async (_event, payload: ProjectFavoritePayload) => {
      await this.registry.setFavorite(payload.id, payload.favorite)
      this.pushState()
    })
    ipcMain.handle(Channel.SETTINGS_GET, () => this.settings.load())
    // 정규화된 값을 **돌려줘야** 화면이 그 값으로 다시 그린다 (useAppSettings 계약).
    //
    // 저장이 세션을 건드리지 않는다. 예전에는 `opencodeUrl` 이 바뀌면 여기서 곧바로
    // 재조립했는데, 그 항목이 없어졌다 — 서버 주소는 이제 설정이 아니라 **우리가 띄운
    // 프로세스가 알려 주는 값**이다 (`opencode/serverPool.ts`).
    ipcMain.handle(Channel.SETTINGS_SET, (_event, payload: AppSettings) => this.settings.save(payload))
    ipcMain.handle(Channel.SESSION_RECONNECT, async () => {
      const active = this.registry.active
      if (active) await this.listener.onReconnect(active)
    })
    ipcMain.handle(Channel.RUNTIME_RESTART, () =>
      this.listener.onRestartRuntime(this.registry.openProjects),
    )
    ipcMain.handle(Channel.COMMAND_LIST, async () => {
      // 목록은 **디렉토리마다 다르다** — 활성 프로젝트 경로를 반드시 실어 보낸다
      // (빼면 서버 cwd 의 목록이 온다. commandList.ts 머리말).
      const result = await fetchCommands(this.serverUrl(), this.registry.active?.root ?? '')
      // 못 받아도 빈 목록으로 돌려준다 — 사유만 함께 알린다
      return {
        ok: result.error === undefined,
        commands: result.commands,
        ...(result.error ? { error: result.error } : {}),
      }
    })
    // opencode 자신의 설정 — 활성 프로젝트의 `opencode.json` 하나만 다룬다.
    ipcMain.handle(Channel.OPENCODE_CONFIG_READ, () =>
      readOpencodeConfig(this.registry.active?.root ?? '', this.serverUrl()),
    )
    ipcMain.handle(Channel.OPENCODE_CONFIG_WRITE, (_event, payload: { path: string; content: string }) =>
      writeOpencodeConfig(payload.path, payload.content),
    )
    // instance 를 버리면 설정을 다시 읽는다. **버린 자리에는 세션도 MCP 등록도 없다** —
    // 그래서 곧바로 다시 붙인다 (SESSION_RECONNECT 와 같은 경로).
    ipcMain.handle(Channel.OPENCODE_CONFIG_RELOAD, async () => {
      const active = this.registry.active
      if (!active) return { ok: false, error: '열린 프로젝트가 없습니다' }
      const result = await disposeInstance(active.root, this.serverUrl())
      if (!result.ok) return result
      await this.listener.onReconnect(active)
      return result
    })
    ipcMain.handle(Channel.PROJECT_LIST_FILES, () => {
      const root = this.registry.active?.root
      return root ? listFiles(root) : { files: [], dirs: [], truncated: false }
    })
    ipcMain.handle(Channel.PROJECT_SEARCH, (_event, payload: { query: string }) => {
      const root = this.registry.active?.root
      return root ? searchText(root, payload.query) : { matches: [], truncated: false }
    })
    ipcMain.handle(Channel.ATTACH_PICK, () =>
      pickAttachments(this.window, this.registry.active?.root ?? null),
    )
    ipcMain.handle(Channel.ATTACH_RESOLVE, (_event, payload: { paths: string[] }) =>
      resolveAttachments(payload.paths, this.registry.active?.root ?? null),
    )
    // 화면이 주소를 실어 보내던 자리다. 이제 고칠 주소가 없다 — 서버는 우리가 띄우고,
    // 진단은 **그 서버**만 본다. (설정 화면에서 주소를 바꿔 저장 전에 확인하던 흐름이
    // 통째로 없어졌다. `shared/settings/appSettings.ts` 의 `opencodeUrl` 제거 근거와 같다.)
    ipcMain.handle(Channel.MODEL_CHECK, async () => {
      const result = await checkModels(this.serverUrl())
      return { ok: result.ok, message: result.detail }
    })
    ipcMain.handle(Channel.SERVER_PING, () => pingOpencode(this.serverUrl()))
    ipcMain.handle(Channel.SERVER_STATUS, () => this.listener.serverStatus())
    // 서버 조작. **실패를 삼키지 않는다** — 실행 파일을 못 찾았다는 사유가 여기로 온다.
    ipcMain.handle(Channel.SERVER_CONTROL, async (_event, payload: ServerControlPayload) => {
      if (this.registry.active === null) {
        return { ok: false, error: '열린 프로젝트가 없습니다', status: this.listener.serverStatus() }
      }
      try {
        await this.listener.onServerControl(payload.action)
        const status = this.listener.serverStatus()
        // **떠 있어야 성공이다.** 조작이 예외 없이 끝나도 서버가 없으면 실패다
        // (시작·다시 시작에서 spawn 이 조용히 못 붙는 경우).
        if (payload.action !== 'stop' && !status.running) {
          return { ok: false, error: '서버가 뜨지 않았습니다 — 로그를 확인하세요', status }
        }
        return { ok: true, status }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          status: this.listener.serverStatus(),
        }
      }
    })
    // 파일 읽기/쓰기/OS 열기/디렉토리 — 300줄 상한 때문에 등록만 갈라냈다
    registerFsHandlers(this.fs)
  }

  /**
   * 활성 프로젝트의 서버 주소. **아직 안 떴으면 빈 문자열이다.**
   *
   * null 대신 빈 문자열로 내리는 이유: 이 값을 받는 넷(`fetchCommands`·`readOpencodeConfig`·
   * `disposeInstance`·프로브)이 이미 "주소가 비면 이런 사유로 실패" 를 각자 갖고 있다.
   * 여기서 갈래를 하나 더 만들면 같은 판단이 두 곳에 생긴다.
   */
  private serverUrl(): string {
    return this.listener.activeServerUrl() ?? ''
  }

  dispose(): void {
    for (const channel of HANDLED_CHANNELS) ipcMain.removeHandler(channel)
  }

  /** 지금 활성인 프로젝트의 세션을 띄운다 (없으면 만든다) */
  activateCurrent(): void {
    const active = this.registry.active
    if (active) this.listener.onActivate(active)
  }

  private snapshot(): ProjectStatePayload {
    return {
      all: this.registry.all,
      open: this.registry.openProjects,
      activeId: this.registry.active?.id ?? null,
    }
  }

  /** 목록이 바뀌었음을 화면에 알린다 */
  pushState(): void {
    if (this.window.isDestroyed()) return
    const payload = this.snapshot()
    this.window.webContents.send(Channel.PROJECT_STATE, payload)
  }

  /** 아카이브를 고르게 하고, 고르면 설치를 위임한다 (에어갭). 취소는 실패가 아니다. */
  private async pick(): Promise<ProjectOpenResultPayload> {
    const result = await dialog.showOpenDialog(this.window, {
      title: '프로젝트 폴더 선택',
      properties: ['openDirectory'],
      buttonLabel: '열기',
    })

    const root = result.filePaths[0]
    // 취소는 실패가 아니다 — 사유 없이 조용히 돌아간다
    if (result.canceled || root === undefined) return { ok: false }
    return this.open(root)
  }

  private async open(root: string): Promise<ProjectOpenResultPayload> {
    const result = await this.registry.open(root)
    this.pushState()
    if (result.ok) this.listener.onActivate(result.project)
    return result.ok ? { ok: true } : { ok: false, message: result.message }
  }
}
