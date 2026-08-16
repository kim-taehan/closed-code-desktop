import type { OutputSnapshot } from '../pty/outputBuffer'
import { openTargetOf, type OpenTarget } from './openFile'
import { commandOf } from './openTerminal'
import { formatLogs, readLogsQuery } from './readLogs'
import { runProjectInput } from './runProject'
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
  /**
   * 그 이름의 칸에서 명령을 **돌린다.** 이미 돌고 있으면 `started: false` 로 그 사실만 온다
   * (`PtyDrawerBridge.run` — 겹쳐 띄우면 개발 서버가 둘이 된다).
   */
  runProject(
    projectId: string,
    name: string,
    command: string,
  ): Promise<{ ok: true; started: boolean } | { ok: false; error: string }>
  /** 그 칸이 붙들고 있는 지나간 출력. 그런 칸이 없으면 null (`outputBuffer.ts`) */
  readLogs(projectId: string, name: string): OutputSnapshot | null
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
    if (name === 'run_project') return await runRunProject(ports, projectId, args, focused)
    // **로그 읽기는 앞에 나와 있지 않아도 된다.** 위 셋과 갈리는 지점이고 이유가 있다:
    // 저쪽은 화면을 건드리는 일이라 뒤에 있는 프로젝트에서는 아무 데도 안 닿지만, 로그는
    // main 이 붙들고 있어(`outputBuffer`) 어느 탭을 보고 있든 그대로 읽힌다. 사용자가 탭을
    // 옮겼다는 이유로 "못 읽는다" 를 돌려주면 모델이 고칠 수 없는 벽이 된다.
    if (name === 'read_logs') return runReadLogs(ports, projectId, args)
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

/**
 * 이름 붙은 칸에서 명령을 돌린다. **시작만 한다** — 정지·재시작은 사람만 하는 일이라
 * 이 도구에 없다 (설계 §3).
 *
 * 앞에 나와 있어야 한다는 규칙이 `open_terminal` 과 같은데 **이유가 더 무겁다**: 뒤에 있는
 * 프로젝트에서 띄우면 그 칸의 탭이 화면에 안 생기고, 탭이 없으면 사용자가 멈출 문(✕)도 없다.
 */
async function runRunProject(
  ports: McpToolPorts,
  projectId: string,
  args: Record<string, unknown>,
  focused: boolean,
): Promise<string> {
  const { name, command } = runProjectInput(args)

  if (!focused) {
    return `\`${command}\` 를 띄우지 못했습니다 — 사용자가 지금 다른 프로젝트를 보고 있습니다. 뒤에 있는 프로젝트에서 띄우면 화면에 탭이 안 생겨 사용자가 멈출 방법이 없습니다. 이 프로젝트 탭으로 옮겨 달라고 한 뒤 다시 부르세요.`
  }

  const result = await ports.runProject(projectId, name, command)
  if (!result.ok) throw new Error(`\`${name}\` 을(를) 띄우지 못했습니다: ${result.error}`)

  // **이미 돌고 있으면 겹쳐 띄우지 않는다** (설계 §3). 조용히 성공이라고 하면 모델은
  // 방금 뜬 것으로 알고 로그의 첫 줄부터 찾는다 — 실제로는 한참 전부터 돌던 것이다.
  if (!result.started) {
    return `\`${name}\` 은(는) **이미 돌고 있어 겹쳐 띄우지 않았습니다.** 지금 상태는 read_logs(name: "${name}") 로 확인하세요. 정말 다시 띄워야 하면 사용자에게 그 탭을 닫아 달라고 청하세요 — 멈추는 일은 사용자만 합니다.`
  }
  return `\`${name}\` 칸에서 \`${command}\` 를 시작했습니다. 화면 아래 드로어에 그 탭이 뜹니다. **끝나기를 기다리지 않습니다** — 출력은 read_logs(name: "${name}") 로 읽으세요. 멈추거나 다시 띄우는 일은 사용자만 합니다(탭의 ✕).`
}

/**
 * 붙들어 둔 출력을 **잘라서** 준다. 자르는 규칙과 머리말은 `readLogs.ts` 에 있다.
 *
 * 없는 칸이면 그렇다고 말한다 — 빈 로그를 돌려주면 모델이 "아무 출력도 없다" 로 읽고
 * 프로세스가 조용한 것으로 결론짓는다. 그 둘은 다른 사실이다.
 */
function runReadLogs(
  ports: McpToolPorts,
  projectId: string,
  args: Record<string, unknown>,
): string {
  const query = readLogsQuery(args)
  const snapshot = ports.readLogs(projectId, query.name)
  if (snapshot === null) {
    return `\`${query.name}\` 이라는 이름으로 도는 것이 없습니다 — 아직 안 띄웠거나(run_project), 사용자가 그 탭을 닫았습니다. 로그가 있었더라도 탭을 닫는 순간 함께 사라집니다.`
  }
  return formatLogs(query, snapshot)
}
