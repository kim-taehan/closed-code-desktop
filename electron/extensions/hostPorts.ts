import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { ExtensionWorkspace } from './workspaceApi'
import { createExtensionStorage, type ExtensionStorage } from './storageStore'
import { exportExtensionFile } from '../ipc/extensionExportFile'
import { askViaLane, type AgentLaneConfig } from '../agentLane/askAgent'
import { CancelBook } from '../agentLane/cancelBook'
import type { DispatchPorts } from './serviceDispatch'
import type { ProjectRegistry } from '../projects/projectRegistry'

// 확장이 앱에 닿는 포트들의 **실제 구현**.
//
// `main.ts` 에서 갈라냈다 — 저쪽은 배선만 하는 자리인데 포트가 넷으로 늘면서 판단
// (창을 언제 찾나·연결이 없으면 어쩌나·저장은 어디에)이 거기 쌓였다.
//
// 전부 **부를 때** 바깥 상태를 다시 읽는다. 확장 호스트는 **앱 수명**이라 창·세션·
// 프로젝트보다 먼저 뜨고, 그 뒤로도 사용자가 탭을 옮기면 바뀐다.

export interface HostPortDeps {
  userDataDir: string
  /** 확장의 파일 접근이 볼 프로젝트들. 확장보다 늦게 생겨 함수로 받는다. */
  registry: () => ProjectRegistry | null
  /**
   * **그 프로젝트의** 코드 어시스턴트 연결. 없으면 `agent.ask` 가 사유와 함께 거절된다.
   *
   * 프로젝트를 받는다 — 저장소가 쓰는 프로젝트와 **같은 것**을 물어야 한다.
   * 어긋나면 A 프로젝트의 목록을 B 워크스페이스에 물어보게 된다 (`bridge.laneFor` 머리말).
   */
  lane: (projectId: string | null) => AgentLaneConfig | null
  /** 지금 보고 있는 프로젝트. 명령 밖에서 온 저장소 호출의 칸을 정한다. */
  activeProjectId: () => string | null
}

/** 포트들 + **중단 손잡이**. 배선하는 쪽(`main.ts`)이 브리지에 넘겨 준다. */
export interface HostPortsResult extends DispatchPorts {
  cancel: (projectId: string | null) => void
}

export function hostPorts(deps: HostPortDeps): HostPortsResult {
  // 도는 질의를 끊을 손잡이. 프로젝트별로 갈린다 (`cancelBook.ts`).
  const book = new CancelBook()

  return {
    cancel: (projectId) => book.cancel(projectId ?? deps.activeProjectId()),
    // 확장의 파일 접근은 전부 이 객체를 거친다 — 프로젝트 밖은 여기서 막힌다.
    workspace: new ExtensionWorkspace(deps.registry),

    // 창은 **부를 때** 찾는다. mac 은 창을 다 닫아도 앱이 산다.
    exportFile: (fileName, text) =>
      exportExtensionFile(BrowserWindow.getAllWindows()[0] ?? null, fileName, text),


    // 확장은 라이선스 키를 못 본다 — 호스트가 자기 레인으로 대신 묻는다.
    // **저장소와 같은 프로젝트에 묻는다.** 겉봉이 없으면(명령 밖) 활성 프로젝트로 —
    // 저장소의 `activeWhenUnknown` 과 같은 규칙이라 둘이 갈릴 자리가 없다.
    ask: (prompt, projectId, onActivity) => {
      const owner = projectId ?? deps.activeProjectId()
      return book.run(owner, (signal) =>
        // 활동 통로는 **주어질 때만** 잇는다 — 안 주면 청크를 예전처럼 그냥 버린다
        askViaLane(deps.lane(owner), prompt, { signal, ...(onActivity ? { onActivity } : {}) }),
      )
    },

    // 확장별·프로젝트별. 분석 대상은 남의 레포라 **거기에 쓰지 않는다** (storageStore.ts 머리말).
    storage: activeWhenUnknown(
      createExtensionStorage(join(deps.userDataDir, 'extension-storage')),
      deps.activeProjectId,
    ),
  }
}

/**
 * 프로젝트를 모르는 저장소 호출을 **지금 보고 있는 프로젝트**로 돌린다.
 *
 * 겉봉의 프로젝트는 "명령을 건 프로젝트" 라, 명령 밖에서 부르면(확장 활성화 시점에
 * 저장된 것을 불러오는 자리) `null` 이다. 그대로 두면 저장한 칸과 읽는 칸이 갈려
 * **껐다 켤 때마다 결과가 사라진 것처럼 보인다.**
 *
 * 명령 안에서는 겉봉이 이긴다 — 오래 걸리는 명령이 도는 중에 사용자가 탭을 옮겨도
 * 결과는 명령을 건 프로젝트에 쌓인다 (행의 겉봉 규칙과 같다).
 */
function activeWhenUnknown(storage: ExtensionStorage, active: () => string | null): ExtensionStorage {
  return {
    get: (extension, project, key) => storage.get(extension, project ?? active(), key),
    set: (extension, project, key, value) => storage.set(extension, project ?? active(), key, value),
  }
}
