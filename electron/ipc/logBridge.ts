import { BrowserWindow, ipcMain } from 'electron'
import { Channel, type LogListResult } from '../../shared/ipc/channels'
import { logStore } from '../logs/logStore'

// 로그 채널만 맡는다. projectBridge 를 키우지 않는 이유는 300줄 상한도 있지만
// 로그가 프로젝트에 매이지 않기 때문이다 — 겉봉(ProjectScoped)을 씌우지 않는다.

const HANDLED_CHANNELS = [Channel.LOG_LIST, Channel.LOG_CLEAR]

export class LogBridge {
  private unsubscribe: (() => void) | null = null

  register(): void {
    ipcMain.handle(Channel.LOG_LIST, (): LogListResult => ({ entries: logStore.all() }))
    ipcMain.handle(Channel.LOG_CLEAR, () => logStore.clear())

    // 새 줄은 열려 있는 모든 창에 보낸다 — 화면이 로그를 보고 있는지 여기서 알 필요가 없다
    this.unsubscribe = logStore.subscribe((entry) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(Channel.LOG_APPEND, entry)
      }
    })
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    for (const channel of HANDLED_CHANNELS) ipcMain.removeHandler(channel)
  }
}
