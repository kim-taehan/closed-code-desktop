import { ExtensionService } from './service'
import { appExtensionPorts } from './appPorts'
import type { HostPortsResult } from './hostPorts'
import type { ForkFn } from './host'
import type { ProjectRegistry } from '../projects/projectRegistry'
import type { AgentLaneConfig } from '../agentLane/askAgent'
import type { ExtensionAskText } from './serviceDispatch'

// 확장 호스트를 **띄우는** 자리. `main.ts` 에서 갈라냈다 — `appPorts.ts` 와 같은 이유로,
// 저쪽은 배선만 하는 자리인데 300줄 상한에 닿았다.
//
// 여기 있는 판단은 둘이다:
//  - **포트를 먼저 만든다** — 중단 손잡이를 확장 브리지도 써야 한다
//  - **기동 실패를 삼키지 않되 던지지도 않는다** — 확장 호스트가 안 떠도 앱은 떠야 한다
//    (계획서 §2.1 이 utilityProcess 를 고른 이유). 이 함수는 창을 만들기 전에 불리므로
//    여기서 던지면 앱 자체가 뜨지 않는다.
//
// 수명은 **창이 아니라 앱**에 매인다 — mac 은 창을 닫아도 앱이 살아 있어
// (window-all-closed 가 darwin 에서 quit 하지 않는다), 창 쪽에서 정리하면 창만 닫은
// 사용자의 호스트가 사라진다. 정리는 `before-quit` 한 곳에서만 한다.

export interface AppHostDeps {
  userDataDir: string
  /** `hostEntry.js` 의 절대 경로 */
  entryPath: string
  /** 실제 `utilityProcess.fork`. 주입받아 vitest(electron 이 가짜)에서도 돈다 */
  fork: ForkFn
  registry: () => ProjectRegistry | null
  /** 그 프로젝트의 세션이 쥔 어시스턴트 연결 (`SessionBridge.laneFor`) */
  laneFor: (projectId: string | null) => AgentLaneConfig | null
  /** 지금 보고 있는 파일. **함수다** — 사유는 `appPorts.ts` 의 같은 이름 필드에 */
  activeFile: () => unknown
  /** 사람에게 묻는 통로. 같은 이유로 함수다 — 창과 함께 생긴다 */
  askText?: ExtensionAskText
  /** 꺼 둔 확장. 부를 때마다 읽는다 — 설정은 앱이 도는 중에 바뀐다 */
  disabledNames: () => Promise<readonly string[]>
  log: (line: string) => void
}

/**
 * **포트는 실패해도 돌려준다.** 기동이 안 돼도 확장 브리지가 중단 손잡이를 써야 하고,
 * 그래서 `service` 만 `null` 이 된다 — 「호스트가 없다」와 「포트가 없다」는 다른 사실이다.
 */
export function startExtensionHost(deps: AppHostDeps): {
  service: ExtensionService | null
  ports: HostPortsResult
} {
  const ports = appExtensionPorts({
    userDataDir: deps.userDataDir,
    registry: deps.registry,
    laneFor: deps.laneFor,
    activeFile: deps.activeFile,
    ...(deps.askText === undefined ? {} : { askText: deps.askText }),
  })

  const service = new ExtensionService({
    entryPath: deps.entryPath,
    fork: deps.fork,
    ...ports,
    disabledNames: deps.disabledNames,
  })
  service.onLog((line) => deps.log(`[확장 호스트] ${line.trim()}`))
  service.onExit((code) => deps.log(`[확장 호스트] 종료 code=${code}`))

  try {
    service.start()
    return { service, ports }
  } catch (error) {
    // 삼키지 않고 앱 로그창에 남긴다 — `captureConsole()` 이 이미 켜져 있다.
    deps.log(`[확장 호스트] 기동 실패: ${error instanceof Error ? error.stack : String(error)}`)
    return { service: null, ports }
  }
}
