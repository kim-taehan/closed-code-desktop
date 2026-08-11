import { hostPorts, type HostPortsResult } from './hostPorts'
import type { ProjectRegistry } from '../projects/projectRegistry'
import type { AgentLaneConfig } from '../agentLane/askAgent'
import type { ExtensionAskText } from './serviceDispatch'

// 확장 포트를 **앱의 실제 상태에 붙이는** 자리.
//
// `main.ts` 에서 갈라냈다 — 저쪽은 배선만 하는 자리인데 300줄 상한에 닿았다.
// 여기 있는 판단은 하나뿐이고, 그것이 이 파일의 존재 이유다:
// **저장소가 쓰는 프로젝트와 어시스턴트에게 묻는 프로젝트가 같아야 한다.**
// 실측에서 둘이 어긋나 Spring 프로젝트의 목록을 프론트엔드 워크스페이스에 물었고,
// "그런 파일 없다" 는 답으로 API 122개 중 42개가 지워졌다.

export interface AppPortDeps {
  userDataDir: string
  registry: () => ProjectRegistry | null
  /** 그 프로젝트의 세션이 쥔 어시스턴트 연결 (`SessionBridge.laneFor`) */
  laneFor: (projectId: string | null) => AgentLaneConfig | null
  /**
   * 지금 편집기에서 보고 있는 파일 (`ExtensionBridge.currentActiveFile`).
   *
   * **함수로 받는다.** 값의 주인은 렌더러이고, 그것을 쥔 브리지는 **창과 함께** 생기는데
   * 확장 호스트는 **앱과 함께** 뜬다 — 여기서 값으로 받으면 늘 기동 순간의 것(=없음)이다.
   *
   * 안 넘겨도 **아무것도 안 터진다.** `workspace.activeFile()` 이 늘 `null` 을 돌려주고,
   * 그건 「안 보고 있다」의 정상 답이라 확장이 조용히 빈 화면을 그린다 (`serviceDispatch.ts`).
   */
  activeFile: () => unknown
  /**
   * 사람에게 묻는 통로 (`ExtensionBridge.askText`).
   *
   * `activeFile` 과 같은 이유로 함수다 — 창과 함께 생기는데 호스트는 앱과 함께 뜬다.
   * **안 넘기면 확장이 사유와 함께 거절당한다** (`refuseAskText`). 저쪽과 달리 조용하지
   * 않다 — 「사람이 취소했다」와 「창이 없다」는 구분되어야 하는 답이다.
   */
  askText?: ExtensionAskText
}

export function appExtensionPorts(deps: AppPortDeps): HostPortsResult {
  const activeProjectId = () => deps.registry()?.active?.id ?? null
  return {
    ...hostPorts({
      userDataDir: deps.userDataDir,
      registry: deps.registry,
      lane: deps.laneFor,
      activeProjectId,
    }),
    activeFile: deps.activeFile,
    ...(deps.askText === undefined ? {} : { askText: deps.askText }),
  }
}
