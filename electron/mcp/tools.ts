import type { ActiveFileNotice } from '../../shared/ipc/extensionPayloads'
import { describeView } from './currentView'
import { openTargetOf, type OpenTarget } from './openFile'
import type { RunProjectTool } from './server'

// 프로젝트 신원 하나로 도구를 돌리는 자리. `server.ts` 가 URL 에서 읽어 넘겨준다.
//
// **앱 상태를 직접 알지 않는다.** 레지스트리도 창도 여기서 import 하지 않고 포트로 받는다 —
// 그래야 테스트가 진짜 프로젝트 없이 이 판단만 겨눌 수 있고, `electron` 을 안 물어 온다.
//
// 도구가 하는 일은 **화면에 알리는 것뿐**이다 — 파일을 직접 읽거나 고치지 않는다.
// 프로젝트 신원은 요청이 스스로 주장하는 것이 아니라 우리가 등록할 때 정해 준 주소로 정해진다.

export interface McpToolPorts {
  /** 열려 있는 프로젝트의 루트. 모르는(닫힌) 프로젝트면 null */
  rootOf(projectId: string): string | null
  /** 지금 앞에 나와 있는 프로젝트 (`ProjectRegistry.active`) */
  focusedProjectId(): string | null
  /** 편집기에서 보고 있는 파일 — 렌더러가 알려 준 마지막 값 (`ActiveFileTracker`) */
  activeFile(): ActiveFileNotice | null
  /** 화면에 파일을 연다. 창이 없어 못 보냈으면 false */
  openInView(projectId: string, target: OpenTarget): boolean
}

export function createToolRunner(ports: McpToolPorts): RunProjectTool {
  return async (projectId, name, args) => {
    const root = ports.rootOf(projectId)
    // 닫힌 프로젝트의 등록은 opencode 쪽에 남아 있을 수 있다 (등록은 instance 수명이고
    // 탭을 닫는다고 지워지지 않는다). 그때 아무 파일도 건드리지 않는다.
    if (root === null) throw new Error('닫힌 프로젝트입니다')

    const focused = ports.focusedProjectId() === projectId

    if (name === 'current_view') {
      return describeView({ focused, activeFile: focused ? ports.activeFile() : null })
    }

    if (name !== 'open_file') throw new Error(`모르는 도구입니다: ${name}`)

    const target = await openTargetOf(root, args)

    // **뒤에 있는 프로젝트에는 열지 못한다.** 공여는 프로젝트마다 탭 상태를 따로 들고
    // 있어서 뒤에서도 열어 둘 수 있었지만, 이 앱은 프로젝트를 옮길 때 파일 탭을 비운다
    // (`src/state/useOpenFiles.ts`) — 열어 봐야 사용자가 그 프로젝트로 돌아오는 순간
    // 사라진다. 조용히 성공했다고 하지 않고 무슨 일이 있었는지 그대로 돌려준다.
    if (!focused) {
      return `${target.path} 을(를) 열지 못했습니다 — 사용자가 지금 다른 프로젝트를 보고 있고, 이 앱은 뒤에 있는 프로젝트의 파일 탭을 유지하지 않습니다. 사용자에게 이 프로젝트 탭으로 옮겨 달라고 한 뒤 다시 부르세요.`
    }

    if (!ports.openInView(projectId, target)) {
      throw new Error('화면이 없어 파일을 열지 못했습니다')
    }
    return `${target.path} 을(를) 화면에 열었습니다`
  }
}
