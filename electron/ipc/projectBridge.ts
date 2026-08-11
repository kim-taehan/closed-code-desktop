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
import { fetchSkills } from '../settings/skillList'
import type { SettingsStore } from '../settings/settingsStore'
import type { AppSettings } from '../../shared/settings/appSettings'
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
  /** runtime 을 새로 띄우고 열려 있는 프로젝트를 모두 되살린다 */
  onRestartRuntime(projects: ProjectRecord[]): Promise<void>
  /** opencode 서버 주소가 설정탭에서 바뀌었다 — config 를 갱신하고 재시작 없이 다시 붙는다 */
  onRuntimeConfigChange(runtime: { opencodeUrl: string }, projects: ProjectRecord[]): Promise<void>
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
  Channel.SESSION_RECONNECT,
  Channel.RUNTIME_RESTART,
  Channel.ATTACH_PICK,
  Channel.ATTACH_RESOLVE,
  Channel.PROJECT_LIST_FILES,
  Channel.PROJECT_SEARCH,
  Channel.SKILL_LIST,
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
    ipcMain.handle(Channel.SETTINGS_SET, async (_event, payload: AppSettings) => {
      const before = await this.settings.load()
      // 정규화된 값을 **돌려줘야** 화면이 그 값으로 다시 그린다 (useAppSettings 계약).
      const saved = await this.settings.save(payload)
      // opencode 서버 주소가 바뀌면 재시작 없이 다시 붙는다 (진행률은 RUNTIME_STATE).
      if (before.opencodeUrl !== payload.opencodeUrl) {
        void this.listener.onRuntimeConfigChange(
          { opencodeUrl: payload.opencodeUrl },
          this.registry.openProjects,
        )
      }
      return saved
    })
    ipcMain.handle(Channel.SESSION_RECONNECT, async () => {
      const active = this.registry.active
      if (active) await this.listener.onReconnect(active)
    })
    ipcMain.handle(Channel.RUNTIME_RESTART, () =>
      this.listener.onRestartRuntime(this.registry.openProjects),
    )
    ipcMain.handle(Channel.SKILL_LIST, async () => {
      const result = await fetchSkills(await this.opencodeUrlOf())
      // 못 받아도 빈 목록으로 돌려준다 — 사유만 함께 알린다
      return { ok: result.error === undefined, skills: result.skills, ...(result.error ? { error: result.error } : {}) }
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
    // 저장 전에도 확인할 수 있어야 하므로, 화면이 준 주소가 있으면 그걸 먼저 쓴다.
    ipcMain.handle(Channel.MODEL_CHECK, async (_event, payload: { opencodeUrl?: string }) => {
      const result = await checkModels(await this.opencodeUrlOf(payload.opencodeUrl))
      return { ok: result.ok, message: result.detail }
    })
    ipcMain.handle(Channel.SERVER_PING, async (_event, payload: { opencodeUrl?: string } = {}) =>
      pingOpencode(await this.opencodeUrlOf(payload.opencodeUrl)),
    )
    // 파일 읽기/쓰기/OS 열기/디렉토리 — 300줄 상한 때문에 등록만 갈라냈다
    registerFsHandlers(this.fs)
  }

  /** 화면이 준 주소 > 저장된 설정. 설정은 빈 값을 기본값으로 정규화해 두므로 여기선 그대로 쓴다. */
  private async opencodeUrlOf(fromForm?: string): Promise<string> {
    const typed = fromForm?.trim()
    if (typed) return typed
    return (await this.settings.load()).opencodeUrl
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
