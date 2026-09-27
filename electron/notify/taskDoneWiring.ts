import { ipcMain, type BrowserWindow } from 'electron'
import { Channel, type TaskNoticePayload } from '../../shared/ipc/channels'
import type { ProjectRegistry } from '../projects/projectRegistry'
import type { SettingsStore } from '../settings/settingsStore'
import { showTaskDone } from './taskNotifier'

// 창이 비활성일 때 「작업 완료」 OS 알림을 거는 배선. `main.ts` 에서 뽑아 왔다 (그 파일이 300줄
// 상한에 닿았고, 원격 채널 훅이 한 줄 들어가야 했다). **판단은 하나도 안 옮겼다** — 아래 두
// 주석이 옮겨온 근거 그대로다.
//
// 비활성 여부를 판정하는 것은 renderer 다 (그쪽이 창의 포커스를 안다). 여기는 설정을 보고
// 프로젝트 이름을 붙여 OS 에 넘기는 일만 한다.

export function installTaskDoneNotice(deps: {
  window: BrowserWindow
  registry: ProjectRegistry
  settings: SettingsStore
}): void {
  // activate 로 창이 다시 만들어질 수 있어 이전 리스너를 지운 뒤 건다 (중복 알림 방지).
  ipcMain.removeAllListeners(Channel.NOTIFY_TASK_DONE)
  ipcMain.on(Channel.NOTIFY_TASK_DONE, async (_event, notice?: TaskNoticePayload) => {
    if (!(await deps.settings.load()).taskDoneNotify) return
    // 이름은 **그 턴의 프로젝트**로 찾는다. 활성 프로젝트를 쓰면 배경에서 끝난 작업에
    // 지금 보고 있는 프로젝트 이름이 찍힌다 (가이드 검토에서 드러남).
    const source = notice?.projectId
      ? deps.registry.all.find((project) => project.id === notice.projectId)
      : deps.registry.active
    showTaskDone(deps.window, { ...notice, ...(source ? { project: source.name } : {}) })
  })
}
