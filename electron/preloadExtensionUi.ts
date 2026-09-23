import { ipcRenderer } from 'electron'
import { Channel, type DesktopBridge, type ProjectHandler } from '../shared/ipc/channels'
import type {
  ExtensionChatPostPayload,
  ExtensionOpenFilePayload,
  ExtensionUiMessagePayload,
  ExtensionUiOpenPayload,
  ExtensionUiOpenViewResult,
  ExtensionUiTarget,
} from '../shared/ipc/extensionUiBridge'

// 웹뷰 탭 배선. preload.ts 가 300줄 상한에 붙어 있어 `preloadGit.ts` 처럼 떼어 냈고,
// preload.ts 가 spread 로 다시 합친다 — **노출 형태와 메서드 이름은 그대로다**.
// `wiring.test.ts` 는 `preload*.ts` 를 전부 훑으므로 여기 invoke 도 스캔에 잡힌다.

type Subscribe = <T>(channel: string, handler: ProjectHandler<T>) => () => void

type ExtensionUiBridge = Pick<
  DesktopBridge,
  'openExtensionUi' | 'closeExtensionUi' | 'sendExtensionUi' | 'onExtensionUiMessage' | 'onExtensionUiOpen' | 'onExtensionChatPost' | 'onExtensionOpenFile'
>

export function extensionUiBridge(subscribe: Subscribe): ExtensionUiBridge {
  return {
    openExtensionUi: (target: ExtensionUiTarget) =>
      ipcRenderer.invoke(Channel.EXTENSION_UI_OPEN_VIEW, target) as Promise<ExtensionUiOpenViewResult>,
    closeExtensionUi: (payload: { token: string }) =>
      ipcRenderer.invoke(Channel.EXTENSION_UI_CLOSE_VIEW, payload) as Promise<void>,
    sendExtensionUi: (payload: ExtensionUiMessagePayload) =>
      ipcRenderer.invoke(Channel.EXTENSION_UI_SEND, payload) as Promise<void>,
    // 겉봉 없는 밀어주기 — 행선지는 토큰이 말한다. 받는 탭이 자기 토큰으로 거른다
    onExtensionUiMessage: (handler: (payload: ExtensionUiMessagePayload) => void) => {
      const listener = (_event: unknown, payload: ExtensionUiMessagePayload) => handler(payload)
      ipcRenderer.on(Channel.EXTENSION_UI_MESSAGE, listener)
      return () => ipcRenderer.removeListener(Channel.EXTENSION_UI_MESSAGE, listener)
    },
    onExtensionUiOpen: (handler: ProjectHandler<ExtensionUiOpenPayload>) =>
      subscribe<ExtensionUiOpenPayload>(Channel.EXTENSION_UI_OPEN, handler),
    onExtensionChatPost: (handler: ProjectHandler<ExtensionChatPostPayload>) =>
      subscribe<ExtensionChatPostPayload>(Channel.EXTENSION_CHAT_POST, handler),
    onExtensionOpenFile: (handler: ProjectHandler<ExtensionOpenFilePayload>) =>
      subscribe<ExtensionOpenFilePayload>(Channel.EXTENSION_OPEN_FILE, handler),
  }
}
