import { Channel } from '../../shared/ipc/channels'
import { toRows, toTreeNodes } from './extensionListPayload'
import type { ExtensionSource } from './extensionBridge'

// 확장이 **밀어 올리는** 것들(행·화면·트리·진행)을 renderer 채널로 잇는다.
//
// ⚠️ 밀어주기 채널이라 `wiring.test.ts` 가 못 잡는다 — 저쪽은 `ipcMain.handle` 만 훑는다.
// 빠뜨리면 확장은 보냈는데 renderer 에는 영영 안 온다 (`ipc-wiring` 스킬 §검증).
//
// `extensionBridge.ts` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았고, 기여점이 하나 늘 때마다
// 필드·구독·해제 **세 자리**를 함께 고쳐야 하던 것도 이쪽으로 모으는 근거다.
// 여기서는 구독을 **한 배열로** 돌려주므로 해제도 한 줄이다.

/** 겉봉을 씌워 창으로 미는 함수. 창이 사라졌거나 겉봉을 만들 수 없으면 아무 일도 안 한다. */
export type SendToWindow = (channel: string, projectId: string | null, payload: unknown) => void

/** 구독 전부. 부르는 쪽은 `dispose` 에서 하나씩 풀면 된다. */
export function subscribePushes(service: ExtensionSource, send: SendToWindow): (() => void)[] {
  return [
    service.onViewRows((viewId, rows, projectId) =>
      send(Channel.EXTENSION_ROWS, projectId, { viewId, rows: toRows(rows) }),
    ),
    service.onViewHtml((viewId, html, projectId) => send(Channel.EXTENSION_HTML, projectId, { viewId, html })),
    service.onViewTree((viewId, nodes, projectId) =>
      send(Channel.EXTENSION_TREE, projectId, { viewId, nodes: toTreeNodes(nodes) }),
    ),
    // 빈 칸을 덜어 내는 일은 **`serviceDispatch` 가 이미 했다** — 여기서 또 조립하면
    // 칸이 하나 늘 때마다 두 자리를 맞춰야 한다. `extension` 은 그 안에 늘 들어 있다.
    service.onProgress((payload, projectId) => send(Channel.EXTENSION_PROGRESS, projectId, payload)),
  ]
}
