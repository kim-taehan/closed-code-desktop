import { Channel } from '../../shared/ipc/channels'

// 이 브리지가 `ipcMain.handle` 로 잡는 채널 전부.
//
// **여기 안 적으면 창을 다시 만들 때 핸들러가 샌다** — `dispose` 가 이 목록으로 푼다.
// 두 번째 등록에서 "handler 이미 있음" 으로 던지는데, 그때 사유는 채널 이름 하나뿐이라
// 어느 배선이 빠졌는지 알 수 없다 (`extensionBridge.test.ts` 가 목록을 통째로 단언하는 이유).
//
// `extensionBridge.ts` 가 300줄 상한에 닿아 갈라냈다. 순수 목록이라 갈라도 잃는 맥락이 없다.

const HANDLED_CHANNELS = [
  Channel.EXTENSION_LIST,
  Channel.EXTENSION_RUN_COMMAND,
  Channel.EXTENSION_REDRAW,
  Channel.EXTENSION_CANCEL,
  Channel.EXTENSION_README,
  Channel.EXTENSION_SET_ENABLED,
  Channel.EXTENSION_UNINSTALL,
  Channel.EXTENSION_EXPORT_CSV,
  Channel.EXTENSION_VIEW_REGISTER,
  Channel.EXTENSION_INSTALL_FROM_DISK,
  Channel.EXTENSION_REGISTRY_LIST,
  Channel.EXTENSION_REGISTRY_ADD,
  Channel.EXTENSION_REGISTRY_REMOVE,
  Channel.EXTENSION_REGISTRY_FETCH,
  Channel.EXTENSION_REGISTRY_README,
  Channel.EXTENSION_REGISTRY_INSTALL,
  Channel.EXTENSION_ASK_TEXT_RESPOND,
]

export { HANDLED_CHANNELS }
