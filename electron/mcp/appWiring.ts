import type { BrowserWindow } from 'electron'
import { Channel } from '../../shared/ipc/channels'
import type { AppSettings } from '../../shared/settings/appSettings'
import { toActiveFile } from '../ipc/extensionActiveFile'
import { logStore } from '../logs/logStore'
import type { ProjectRegistry } from '../projects/projectRegistry'
import { DesktopMcp } from './desktopMcp'
import type { McpToolPorts } from './tools'

// 데스크톱 MCP 서버를 **앱 상태에 잇는** 자리. `main.ts` 에서 뽑아 왔다 (그 파일이 300줄
// 상한에 닿았다). 판단은 하나도 안 옮겼고 배선만 왔다 — 여기 있는 편이 낫기도 하다:
// 이 포트들이 왜 "값" 이 아니라 "함수" 여야 하는지가 `DesktopMcp` 바로 옆에 있게 된다.
//
// ⚠️ **지역변수를 잡지 않는다.** `DesktopMcp` 는 앱 수명이고 창·레지스트리는 창 수명이다.
// macOS 는 창을 다 닫아도 앱이 살아 있고(`window-all-closed` 가 quit 하지 않는다), 독에서
// 되살리면 `createWindow()` 가 **새 window·새 registry** 를 만든다. 한 번 잡아 두면
// 죽은 창을 영영 바라보며 에이전트에게 "화면이 없어 파일을 열지 못했습니다" 만 돌려준다.
// 그래서 전부 **그때그때 읽는 함수**로 받는다.

export interface DesktopMcpDeps {
  /** 스위치와 서버 주소. 설정탭에서 바뀌므로 매번 읽는다 */
  settings: () => Promise<AppSettings>
  /** 지금 레지스트리. 창과 함께 새로 생긴다 */
  registry: () => ProjectRegistry | null
  /** 지금 창. 창과 함께 새로 생긴다 */
  window: () => BrowserWindow | null
  /** 렌더러가 알려 준 마지막 활성 파일 (`ExtensionBridge.currentActiveFile`) */
  activeFile: () => unknown
  /** 그 프로젝트의 opencode 서버 주소 (`opencode/serverPool.ts`). 안 떴으면 null */
  serverUrl: (projectId: string) => string | null
}

/**
 * 앱 상태를 읽는 포트 넷. **따로 내보내는 이유는 시험 때문이다** —
 * 낡은 세대를 보는지는 이 넷을 직접 두들겨야 알 수 있고, `DesktopMcp` 안을 들추면
 * private 에 기대는 시험이 된다.
 */
export function desktopMcpPorts(deps: DesktopMcpDeps): McpToolPorts {
  return {
    // **열린 프로젝트만** 안다. 탭을 닫으면 그 순간 아무 파일도 못 건드린다.
    rootOf: (id) => deps.registry()?.openProjects.find((p) => p.id === id)?.root ?? null,
    focusedProjectId: () => deps.registry()?.active?.id ?? null,
    // 값의 주인은 렌더러다 — main 이 짐작하지 않는다 (`extensionActiveFile.ts` 머리말).
    activeFile: () => toActiveFile(deps.activeFile()),
    // 겉봉(ProjectScoped)을 씌워 보낸다 — 화면은 지금 보고 있는 프로젝트 것만 받는다
    openInView: (projectId, target) => {
      const window = deps.window()
      if (window === null || window.isDestroyed()) return false
      window.webContents.send(Channel.DESKTOP_MCP_OPEN_FILE, { projectId, payload: target })
      return true
    },
  }
}

export function createDesktopMcp(deps: DesktopMcpDeps): DesktopMcp {
  return new DesktopMcp({
    settings: async () => ({ desktopMcp: (await deps.settings()).desktopMcp }),
    // 주소도 **그때그때** 읽는다 — 프로젝트마다 다르고, 탭을 닫았다 열면 새 서버가 뜬다
    serverUrl: deps.serverUrl,
    ports: desktopMcpPorts(deps),
    log: (line) => logStore.add('desktop', line),
  })
}
