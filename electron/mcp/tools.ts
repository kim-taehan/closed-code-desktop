import { openTargetOf, type OpenTarget } from './openFile'
import { commandOf } from './openTerminal'
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
  /** 화면에 파일을 연다. 창이 없어 못 보냈으면 false */
  openInView(projectId: string, target: OpenTarget): boolean
  /**
   * 셸 칸을 펴고, 명령이 있으면 **채워만 둔다** (실행하지 않는다).
   * 창이 없거나 셸 배선이 없어 못 보냈으면 false.
   */
  openTerminal(projectId: string, command: string | null): boolean
}

export function createToolRunner(ports: McpToolPorts): RunProjectTool {
  return async (projectId, name, args) => {
    const root = ports.rootOf(projectId)
    // 닫힌 프로젝트의 등록은 opencode 쪽에 남아 있을 수 있다 (등록은 instance 수명이고
    // 탭을 닫는다고 지워지지 않는다). 그때 아무 파일도 건드리지 않는다.
    if (root === null) throw new Error('닫힌 프로젝트입니다')

    // **뒤에 있는 프로젝트에는 아무것도 못 한다** — 도구 둘이 같은 규칙을 쓴다.
    // 이 앱은 프로젝트를 옮길 때 파일 탭을 비우고(`src/state/useOpenFiles.ts`), 셸 칸도
    // 앞에 나와 있는 프로젝트의 것 하나뿐이다(`useShellDrawer`). 뒤에서 해 봐야 사용자가
    // 돌아오는 순간 사라지거나 남의 프로젝트 화면에 나타난다.
    const focused = ports.focusedProjectId() === projectId

    if (name === 'open_file') return await runOpenFile(ports, projectId, root, args, focused)
    if (name === 'open_terminal') return runOpenTerminal(ports, projectId, args, focused)
    throw new Error(`모르는 도구입니다: ${name}`)
  }
}

async function runOpenFile(
  ports: McpToolPorts,
  projectId: string,
  root: string,
  args: Record<string, unknown>,
  focused: boolean,
): Promise<string> {
  const target = await openTargetOf(root, args)

  // 조용히 성공했다고 하지 않고 무슨 일이 있었는지 그대로 돌려준다.
  if (!focused) {
    return `${target.path} 을(를) 열지 못했습니다 — 사용자가 지금 다른 프로젝트를 보고 있고, 이 앱은 뒤에 있는 프로젝트의 파일 탭을 유지하지 않습니다. 사용자에게 이 프로젝트 탭으로 옮겨 달라고 한 뒤 다시 부르세요.`
  }

  if (!ports.openInView(projectId, target)) {
    throw new Error('화면이 없어 파일을 열지 못했습니다')
  }
  return `${target.path} 을(를) 화면에 열었습니다`
}

/**
 * 셸 칸을 펴고 명령을 채운다. **돌려주는 문장이 이 도구의 절반이다** —
 * 모델이 이 말을 읽고 사용자에게 확인을 청하지 않으면, 채워 둔 명령은 아무도 안 본 채로 남는다.
 */
function runOpenTerminal(
  ports: McpToolPorts,
  projectId: string,
  args: Record<string, unknown>,
  focused: boolean,
): string {
  const command = commandOf(args)

  if (!focused) {
    return `셸 칸을 열지 못했습니다 — 사용자가 지금 다른 프로젝트를 보고 있고, 셸 칸은 앞에 나와 있는 프로젝트의 것 하나뿐입니다. 사용자에게 이 프로젝트 탭으로 옮겨 달라고 한 뒤 다시 부르세요.`
  }

  if (!ports.openTerminal(projectId, command)) {
    throw new Error('화면이 없어 셸 칸을 열지 못했습니다')
  }
  if (command === null) return '셸 칸을 폈습니다. 명령은 넣지 않았습니다.'
  return `셸 칸에 \`${command}\` 를 **채워만 뒀습니다 — 실행하지 않았습니다.** 사용자가 화면에서 이 명령을 확인하고 직접 엔터를 쳐야 돌아갑니다. 사용자에게 확인을 요청하고, 결과가 필요하면 사용자가 실행한 뒤에 물어보세요.`
}
