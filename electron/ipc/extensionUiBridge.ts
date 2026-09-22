import { ipcMain, type BrowserWindow } from 'electron'
import { Channel } from '../../shared/ipc/channels'
import { checkUiMessage } from '../../shared/extensions/uiMessage'
import type {
  ExtensionUiMessagePayload,
  ExtensionUiOpenViewResult,
  ExtensionUiTarget,
} from '../../shared/ipc/extensionUiBridge'
import type { ExtensionUiRouter } from '../extensions/uiRouter'

// 웹뷰 탭(매니페스트 3판) 채널 배선 — 창 수명.
//
// `extensionBridge.ts` 와 가른 이유: 저쪽이 300줄 상한에 붙어 있고, 이쪽은 수명이 둘로 갈리는
// 자리를 잇는다 — 토큰 표·확장 호스트(앱 수명, `uiRouter.ts`)와 이 창. 붙을 때 `router.attach`
// 로 실어 갈 길을 걸고, 떨어질 때 뗀다 (떼면 토큰도 전부 놓는다 — 탭이 창과 함께 사라졌다).
//
// **메시지는 토큰으로만 다닌다.** 앞단이 올린 것의 확장·뷰·프로젝트는 여기서 토큰으로 푼다
// (`uiServer.binding`). 화면이 실어 보낸 값을 믿으면 틀린 값이 남의 확장으로 간다.

/** 이 배선이 쓰는 `ExtensionService` 표면만 */
export interface ExtensionUiSource {
  webview(
    extension: string,
    viewId: string,
    projectId: string,
  ): Promise<{ ok: true; dir: string; entry: string; title: string } | { ok: false; reason: string }>
  uiMessage(extension: string, viewId: string, projectId: string, message: unknown): Promise<void>
}

export interface ExtensionUiBridgeOptions {
  window: BrowserWindow
  service: ExtensionUiSource
  router: ExtensionUiRouter
}

/** `ipcMain.handle` 로 붙이는 것 전부. `dispose` 가 이 목록으로 푼다 */
export const UI_HANDLED_CHANNELS = [
  Channel.EXTENSION_UI_OPEN_VIEW,
  Channel.EXTENSION_UI_CLOSE_VIEW,
  Channel.EXTENSION_UI_SEND,
] as const

export class ExtensionUiBridge {
  private detach: (() => void) | null = null

  constructor(private readonly options: ExtensionUiBridgeOptions) {}

  register(): void {
    const { router, service } = this.options
    ipcMain.handle(Channel.EXTENSION_UI_OPEN_VIEW, (_event, target: ExtensionUiTarget) => this.openView(target))
    ipcMain.handle(Channel.EXTENSION_UI_CLOSE_VIEW, (_event, payload: { token: string }) => {
      router.server.release(payload.token)
    })
    // 거부는 그대로 던진다 — 탭이 받아 앞단에 `__app:rejected` 로 사유를 돌려준다
    ipcMain.handle(Channel.EXTENSION_UI_SEND, async (_event, payload: ExtensionUiMessagePayload) => {
      const bound = router.server.binding(payload.token)
      if (bound === null) throw new Error('닫힌 확장 화면입니다')
      const checked = checkUiMessage(payload.message)
      if (!checked.ok) throw new Error(checked.reason)
      await service.uiMessage(bound.extension, bound.viewId, bound.projectId, payload.message)
    })
    this.detach = router.attach({
      toTab: (token, message) => this.send(Channel.EXTENSION_UI_MESSAGE, { token, message }),
      // 제목을 실어 보낸다 — 탭 이름표는 여는 순간 정해진다. 켜지지 않았거나 없는 뷰면 여기서
      // 거부해 확장의 `code.ui.open` 이 사유를 받는다 (화면에 빈 탭을 만들지 않는다)
      openTab: async (projectId, extension, viewId) => {
        const found = await service.webview(extension, viewId, projectId)
        if (!found.ok) throw new Error(found.reason)
        this.send(Channel.EXTENSION_UI_OPEN, { projectId, payload: { extension, viewId, title: found.title } })
      },
    })
  }

  dispose(): void {
    for (const channel of UI_HANDLED_CHANNELS) ipcMain.removeHandler(channel)
    this.detach?.()
    this.detach = null
  }

  /** 켜졌고 선언된 웹뷰인지(서비스) → 파일이 `ui/` 안에 있는지(서버). 둘 다 사유를 돌려준다 */
  private async openView(target: ExtensionUiTarget): Promise<ExtensionUiOpenViewResult> {
    const found = await this.options.service.webview(target.extension, target.viewId, target.projectId)
    if (!found.ok) return found
    const opened = await this.options.router.server.open({
      extension: target.extension,
      viewId: target.viewId,
      projectId: target.projectId,
      extensionDir: found.dir,
      entry: found.entry,
    })
    return opened.ok ? { ...opened, title: found.title } : opened
  }

  private send(channel: string, payload: unknown): void {
    const window = this.options.window
    if (window.isDestroyed()) return
    window.webContents.send(channel, payload)
  }
}
