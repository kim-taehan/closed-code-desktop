import { ipcMain, type BrowserWindow } from 'electron'
import { Channel } from '../../shared/ipc/channels'
import { createActiveFileTracker } from './extensionActiveFile'
import { createAskText } from './extensionAskText'
import { HANDLED_CHANNELS } from './extensionBridgeChannels'
import type {
  ExtensionExportCsvPayload,
  ExtensionListPayload,
  ExtensionProgressPayload,
  ExtensionReadmePayload,
  ExtensionRunCommandPayload,
  ExtensionSetEnabledPayload,
  ExtensionUninstallPayload,
  ExtensionViewRegisterPayload,
} from '../../shared/ipc/extensionPayloads'
import { exportExtensionCsv } from './extensionExportCsv'
import type { SettingsStore } from '../settings/settingsStore'
import { defaultExtensionsDir } from '../extensions/registry'
import { installFromDisk } from './extensionInstallFromDisk'
import { readExtensionReadme } from '../extensions/readme'
import { registerRegistryHandlers } from './extensionRegistryHandlers'
import { toListPayload, type ManifestLike } from './extensionListPayload'
import { subscribePushes } from './extensionPushes'
import {
  afterInstall as afterInstallReload,
  setExtensionEnabled,
  uninstallInstalled,
  type ManageDeps,
} from './extensionManageHandlers'

// 확장 채널 배선.
//
// ⚠️ runtime 의 **플러그인(Plugin)** 과 다른 체계다 (계획서 §0). 문구를 섞지 않는다.
//
// **`projectBridge` 에 넣지 않았다.** 거기 들어가면 프로젝트 겉봉(`ProjectScoped`)이
// 씌워지는데, 확장은 앱에 설치되는 것이지 프로젝트에 매이지 않는다. `gitBridge` 가
// 같은 이유로 갈라져 있다.
//
// 이 파일이 잇는 것이 둘이다:
//  - **설치본 관리** — 목록·디스크 설치·배포처(조회/내려받아 설치)
//  - **실행** — 확장이 선언한 명령 실행과 그 결과 행
//
// 목록은 `scanExtensions` 를 직접 부르지 않고 **호스트 서비스에 묻는다.** 서비스 쪽이
// 훑기 사유에 더해 **싣기 실패**(require 오류·activate 없음)까지 합쳐 주기 때문이다 —
// 직접 훑으면 "폴더는 멀쩡한데 안 뜨는" 확장의 이유가 사라진다.

/**
 * 이 브리지가 쓰는 `ExtensionService` 표면만 추린 구조 타입.
 *
 * 구체 클래스를 직접 물지 않는 이유가 둘이다: 확장 쪽 구현이 바뀌어도 배선이 흔들리지
 * 않고, 테스트에서 가짜를 끼울 수 있다 (`wiring.test.ts` 가 그렇게 쓴다).
 */
export interface ExtensionSource {
  listExtensions(): Promise<{
    /** `enabled` 는 서비스가 판정한다 — 꺼 둔 것도 목록에는 남는다 */
    extensions: { dir: string; manifest: ManifestLike; enabled: boolean }[]
    skipped: { dir: string; reason: string; detail?: string }[]
  }>
  /** 두 번째 인자는 **명령을 건 프로젝트**다 — 그 실행에서 나온 행의 겉봉이 된다. */
  runCommand(commandId: string, projectId: string | null, selection?: unknown): Promise<void>
  /**
   * 저장된 것을 지금 프로젝트 기준으로 다시 그리게 한다. **화면이 붙은 뒤 화면이 부른다** —
   * 확장의 활성화 시점 그리기는 화면보다 먼저 끝날 수 있고, 밀어 넣기는 재생되지 않는다.
   */
  redraw(projectId: string | null): Promise<void>
  /** 보고 있는 파일이 바뀌었다고 알린다. `redraw` 와 갈라 둔 이유는 `rpc.ts` 머리말에 */
  activeFileChanged(file: unknown, projectId: string | null): Promise<void>
  /** 디스크를 다시 훑어 다시 싣는다. 설치 직후에 부른다 (`afterInstall`). */
  reload(): Promise<void>
  /** 자식을 갈아 끼운다. **덮어쓴 설치**에서만 — 그때만 require 캐시가 걸림돌이다. */
  restart(): Promise<void>
  /** 세 번째 인자는 그 행을 낸 명령의 프로젝트. 명령 밖에서 온 행이면 null 이다. */
  onViewRows(
    handler: (viewId: string, rows: unknown[], projectId: string | null) => void,
  ): () => void
  /** `view.setHtml` 로 올라온 화면. 겉봉 규칙은 `onViewRows` 와 같다. */
  onViewHtml(
    handler: (viewId: string, html: string, projectId: string | null) => void,
  ): () => void
  /** `view.setTree` 로 올라온 트리. 겉봉 규칙은 같다. */
  onViewTree(
    handler: (viewId: string, nodes: unknown[], projectId: string | null) => void,
  ): () => void
  /** `davis.progress` 로 올라온 진행 상황. 겉봉 규칙은 같고, 주인은 payload 안에 있다. */
  onProgress(handler: (payload: ExtensionProgressPayload, projectId: string | null) => void): () => void
}

export interface ExtensionBridgeOptions {
  /** 파일 선택창을 띄울 부모 창, 그리고 결과 행을 밀 창 */
  window: BrowserWindow
  /** 목록·명령 실행을 맡는 확장 호스트 */
  service: ExtensionSource
  /**
   * 확장 화면을 `davis-ext://` 로 내주는 곳 (`ExtensionViewHost`).
   *
   * 구체 클래스를 물지 않는다 — `service` 와 같은 이유로 시험에서 가짜를 끼운다.
   */
  views: { register(doc: string): string }
  /**
   * 지금 활성인 프로젝트. 두 자리에 쓰인다 — **명령을 거는 순간** 겉봉을 굳히는 값이고,
   * 명령 밖에서 올라온 행(활성화 시점·타이머)의 겉봉이다.
   *
   * 함수로 받는다 — 확장 호스트는 **앱 수명**이라 프로젝트가 정해지기 전에 뜨고,
   * 그 뒤로도 탭을 옮기면 바뀐다.
   */
  activeProjectId: () => string | null
  /**
   * 배포처 주소가 사는 곳 (`settings.json` 의 `extensionRegistries`).
   *
   * **앱이 이미 만든 인스턴스를 받는다.** 여기서 새로 만들면 캐시가 갈려 설정 화면이
   * 저장한 값과 이쪽이 보는 값이 어긋난다.
   */
  settings: SettingsStore
  /**
   * 도는 확장 질의를 끊는다 (`hostPorts` 의 `cancel`).
   *
   * 서비스가 아니라 포트 쪽에 있다 — 끊을 대상이 **어시스턴트 소켓**이라 그것을 쥔
   * 자리에서만 끊을 수 있다. 안 주면 중단 요청이 조용히 무시된다.
   */
  cancel?: (projectId: string | null) => void
  /** 패키지가 풀리는 곳. 기본은 `~/.davis-code/desktop-extensions` */
  extensionsDir?: string
  /** 시험에서 갈아끼운다. 기본은 main 프로세스의 전역 fetch */
  fetchImpl?: typeof fetch
}

// `ipcMain.handle` 로 붙인 것만 여기 든다. **`EXTENSION_ACTIVE_FILE` 은 없다** —
// 저건 `on` 으로 붙어서 `removeHandler` 가 아무 일도 안 하고, 해제는 `pushes` 가 한다.

export class ExtensionBridge {
  private readonly extensionsDir: string
  /** 확장이 밀어 올리는 것들의 구독 (`extensionPushes.ts`). `dispose` 에서 한꺼번에 푼다 */
  private pushes: (() => void)[] = []
  /** 보고 있는 파일을 쥐고 확장에 넘긴다 (`extensionActiveFile.ts`) */
  private readonly activeFile = createActiveFileTracker(
    { activeFileChanged: (file, projectId) => this.options.service.activeFileChanged(file, projectId) },
    () => this.options.activeProjectId(),
  )

  /**
   * 확장이 사람에게 묻는 통로 (`extensionAskText.ts`).
   *
   * **창에 매여 있어 여기가 자리다.** 확장 호스트는 앱 수명이라 이것을 값이 아니라
   * 함수로 받아 간다 (`currentActiveFile` 과 같은 규칙, `main.ts` 배선).
   */
  readonly askText = createAskText(() => this.options.window)

  constructor(private readonly options: ExtensionBridgeOptions) {
    this.extensionsDir = options.extensionsDir ?? defaultExtensionsDir()
  }

  register(): void {
    ipcMain.handle(Channel.EXTENSION_LIST, () => this.list())

    // 실패를 결과 객체로 감싸지 않고 그대로 거부시킨다 — 부르는 쪽(사이드바)이
    // 토스트로 사유를 띄운다. 여기서 삼키면 버튼을 눌러도 아무 일이 없는 것처럼 보인다.
    //
    // 겉봉은 **여기서** 굳는다. 명령이 끝날 때 활성 프로젝트를 다시 조회하면, 오래 걸리는
    // 명령이 도는 중에 탭을 옮겼을 때 결과가 엉뚱한 탭에 그려진다.
    ipcMain.handle(Channel.EXTENSION_RUN_COMMAND, (_event, payload: ExtensionRunCommandPayload) =>
      this.options.service.runCommand(payload.commandId, this.options.activeProjectId(), payload.selection),
    )

    // **화면이 요청한다.** 확장의 활성화 시점 그리기는 화면이 붙기 전에 끝날 수 있고,
    // 프로젝트를 옮기면 화면은 비워지는데 확장은 그 사실을 모른다 (`service.redraw` 머리말).
    ipcMain.handle(Channel.EXTENSION_REDRAW, () => this.options.service.redraw(this.options.activeProjectId()))

    // 값의 주인은 렌더러다. main 은 마지막 값을 들고 있다가 두 곳에 준다 —
    // 확장이 당겨 가는 `workspace.activeFile()` 과, 밀어 주는 `onActiveFile`.
    this.pushes.push(this.activeFile.listen())

    // 겉봉은 **여기서** 굳는다 — 다른 탭에서 도는 질의를 끊지 않는다
    ipcMain.handle(Channel.EXTENSION_CANCEL, () => {
      this.options.cancel?.(this.options.activeProjectId())
    })

    ipcMain.handle(Channel.EXTENSION_README, (_event, payload: ExtensionReadmePayload) =>
      readExtensionReadme(this.extensionsDir, payload.name),
    )
    ipcMain.handle(Channel.EXTENSION_SET_ENABLED, (_event, payload: ExtensionSetEnabledPayload) =>
      setExtensionEnabled(this.manageDeps, payload),
    )
    ipcMain.handle(Channel.EXTENSION_UNINSTALL, (_event, payload: ExtensionUninstallPayload) =>
      uninstallInstalled(this.manageDeps, payload),
    )
    ipcMain.handle(Channel.EXTENSION_EXPORT_CSV, (_event, payload: ExtensionExportCsvPayload) =>
      exportExtensionCsv(this.options.window, payload),
    )
    // 문서를 만드는 일은 renderer 가 한다(테마 색을 아는 곳이 거기뿐이다). 여기서는 URL 만 내준다.
    ipcMain.handle(Channel.EXTENSION_VIEW_REGISTER, (_event, payload: ExtensionViewRegisterPayload) => ({
      url: this.options.views.register(payload.doc),
    }))
    // 디스크 설치와 배포처 설치가 **같은 `afterInstall`** 을 지난다 (`extensionInstallFromDisk.ts`)
    ipcMain.handle(Channel.EXTENSION_INSTALL_FROM_DISK, () =>
      installFromDisk({
        window: this.options.window,
        extensionsDir: this.extensionsDir,
        afterInstall: (result, replaced) => this.afterInstall(result, replaced),
      }),
    )

    // 배포처는 등록까지 통째로 갈라 뒀다 (extensionRegistryHandlers.ts) — 상태를 쥐지 않아
    // 이 클래스 안에 있을 이유가 없고, 이 파일이 300줄 상한에 붙어 있다.
    registerRegistryHandlers(
      {
        settings: this.options.settings,
        extensionsDir: this.extensionsDir,
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      },
      (result, replaced) => this.afterInstall(result, replaced),
    )

    // **덧붙인다.** `this.pushes = …` 로 갈아끼우면 위에서 넣은 활성 파일 해제 함수가
    // 통째로 버려져, dispose 뒤에도 청취가 남는다 (`extensionBridge.activeFile.test.ts`).
    this.pushes.push(
      ...subscribePushes(this.options.service, (channel, projectId, payload) =>
        this.send(channel, projectId, payload),
      ),
    )
  }

  /**
   * 확장이 `workspace.activeFile()` 로 **당겨 갈** 값. 밀기(`onActiveFile`)와 짝이다 —
   * 밀기만 있으면 확장이 **켜진 직후**를 못 채운다 (그때는 아직 아무 알림도 안 왔다).
   */
  currentActiveFile(): unknown {
    return this.activeFile.current()
  }

  dispose(): void {
    for (const channel of HANDLED_CHANNELS) ipcMain.removeHandler(channel)
    for (const off of this.pushes) off()
    this.pushes = []
  }

  /**
   * 확장 결과를 창으로 민다. 겉봉이 없으면(명령 밖에서 온 것) 지금 활성 프로젝트로 친다.
   *
   * 행과 화면이 같은 규칙을 쓰므로 한 자리에 둔다 — 겉봉 판정이 두 벌이 되면 한쪽만 고쳐진다.
   */
  private send(channel: string, projectId: string | null, payload: unknown): void {
    if (this.options.window.isDestroyed()) return
    const owner = projectId ?? this.options.activeProjectId()
    if (owner === null) return
    this.options.window.webContents.send(channel, { projectId: owner, payload })
  }

  /** 켜고 끄고 지우는 쪽이 쓰는 것 (extensionManageHandlers.ts) */
  private get manageDeps(): ManageDeps {
    return {
      settings: this.options.settings,
      extensionsDir: this.extensionsDir,
      service: this.options.service,
    }
  }

  /** 설치돼 실린 확장 목록. 화면이 쓰는 모양으로 추리는 것은 `toListPayload` 가 한다. */
  private async list(): Promise<ExtensionListPayload> {
    return toListPayload(await this.options.service.listExtensions())
  }

  /**
   * 설치가 끝났으니 **다시 훑어 다시 싣는다.** 두 설치 경로(디스크·배포처)가 같이 지난다.
   *
   * 이것이 없으면 새 확장은 앱을 껐다 켜야 보인다 (`ExtensionService.reload` 머리말).
   * 화면이 설치 성공을 받고 목록을 다시 읽는 순간 이미 갱신돼 있어야 하므로,
   * **응답을 돌려주기 전에** 기다린다.
   *
   * 재싣기가 실패해도 설치 자체는 성공이다 — 여기서 결과를 실패로 뒤집으면 사용자가
   * 이미 디스크에 들어간 확장을 다시 설치하려 든다. 사유는 서비스가 앱 로그로 흘린다.
   *
   * `replaced`(덮어쓴 설치 = 업데이트)면 다시 싣는 것으로 부족해 **자식을 갈아 끼운다** —
   * 판단은 `extensionManageHandlers.afterInstall` 한곳에 있다.
   */
  private async afterInstall<T extends { ok: boolean }>(result: T, replaced: boolean): Promise<T> {
    if (result.ok) await afterInstallReload(this.manageDeps, replaced)
    return result
  }
}

