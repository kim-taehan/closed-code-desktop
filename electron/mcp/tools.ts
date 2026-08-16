import type { OutputSnapshot } from '../pty/outputBuffer'
import { openTargetOf, type OpenTarget } from './openFile'
import { commandOf } from './openTerminal'
import { formatLogs, readLogsQuery } from './readLogs'
import { runProjectInput } from './runProject'
import { runCommandsInput, saveRunCommands } from './saveRunCommands'
import type { RunProjectTool } from './server'

// 프로젝트 신원 하나로 도구를 돌리는 자리. `server.ts` 가 URL 에서 읽어 넘겨준다.
//
// **앱 상태를 직접 알지 않는다.** 레지스트리도 창도 여기서 import 하지 않고 포트로 받는다 —
// 그래야 테스트가 진짜 프로젝트 없이 이 판단만 겨눌 수 있고, `electron` 을 안 물어 온다.
//
// 프로젝트 신원은 요청이 스스로 주장하는 것이 아니라 우리가 등록할 때 정해 준 주소로 정해진다.
//
// ⚠️ 여기에는 **"도구가 하는 일은 화면에 알리는 것뿐이고 파일을 고치지 않는다"** 고 적혀
// 있었다. 도구 넷일 때는 참이었고 `save_run_commands` 가 들어오며 거짓이 됐다 — 그것은
// **실행 목록을 앱 저장소에 쓴다** (처음에는 프로젝트의 AGENTS.md 였다. 옮긴 이유는
// `shared/run/runList.ts` 머리말). 그래서 규칙을 고쳐 적는다: **파일을 고치는 도구는 자기
// 파일 조작을 자기 모듈에 두고**(`saveRunCommands.ts`), 이 파일은 갈래와 돌려줄 문장만 정한다.

export interface McpToolPorts {
  /** 열려 있는 프로젝트의 루트. 모르는(닫힌) 프로젝트면 null */
  rootOf(projectId: string): string | null
  /** 지금 앞에 나와 있는 프로젝트 (`ProjectRegistry.active`) */
  focusedProjectId(): string | null
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
  /**
   * 실행 목록을 두는 앱 저장소 폴더 (`~/Library/Application Support/.../run-lists`).
   *
   * **경로를 여기서 짓지 않고 받는다** — 이 폴더를 짓는 것은 `run/runListDir.ts` 하나이고
   * (`extensions/hostPorts.ts` 의 `userDataDir` 과 같은 규칙), 그래야 이 파일의 시험이
   * electron 을 안 물어 온다.
   *
   * **여기는 함수로 받고 `ipc/runListHandlers.ts` 는 이미 부른 문자열(`dir`)로 받는다.**
   * 같은 폴더를 보는 두 배선인데 모양이 갈린 것은 배선 시점이 달라서다 — 이쪽은 포트 표를
   * 짤 때(`mcp/appWiring.ts`) 함수를 그대로 얹고, 저쪽은 핸들러를 등록할 때
   * (`ipc/projectBridge.ts`) 한 번 불러 넣는다. **둘이 같은 폴더를 봐야 한다**
   * (`runListDir.ts` 머리말, `ipc/runListWiring.test.ts`).
   */
  runListDir(): string
  /**
   * 실행 목록이 방금 바뀌었다 — **화면에 알린다.**
   *
   * 파일을 고치는 것은 `saveRunCommands` 가 이미 끝냈고 여기서는 알리기만 한다. 안 알리면
   * 사이드바가 20초 전에 읽어 둔 목록을 그대로 들고 있어, 사용자에게는 「찾을까요?」를
   * 눌렀는데 아무 일도 안 일어난 것으로 보인다 (사용자가 ↻ 를 누를 때까지).
   */
  runListChanged(projectId: string): void
}

export function createToolRunner(ports: McpToolPorts): RunProjectTool {
  return async (projectId, name, args) => {
    const root = ports.rootOf(projectId)
    // 닫힌 프로젝트의 등록은 opencode 쪽에 남아 있을 수 있다 (등록은 instance 수명이고
    // 탭을 닫는다고 지워지지 않는다). 그때 아무 파일도 건드리지 않는다.
    if (root === null) throw new Error('닫힌 프로젝트입니다')

    // **뒤에 있는 프로젝트에는 아무것도 못 한다** — 화면을 건드리는 도구들이 같은 규칙을 쓴다.
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
    // **적는 것도 앞에 나와 있지 않아도 된다** — 저장소에 적는 일이고 화면을 건드리지 않는다.
    // 사용자가 다른 탭을 보는 동안 적어 둬도 그 프로젝트로 돌아오면 그대로 있다.
    if (name === 'save_run_commands') return await runSaveRunCommands(ports, projectId, root, args)
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

/**
 * 알아낸 실행 방법을 **앱 저장소**에 적는다 (설계 §2 — 한 번 적으면 다음부터 모델을 안 부른다).
 *
 * 위 셋과 달리 **아무것도 실행하지 않는다.** 돌려주는 문장이 그 사실을 분명히 해야 한다 —
 * 모델이 "띄웠다" 로 읽고 사용자에게 그렇게 말하면, 사용자는 뜨지도 않은 서버를 찾는다.
 *
 * **어느 파일에 적었는지는 말하지 않는다.** 프로젝트 밖의 해시 이름 파일이라 사용자가 갈 곳이
 * 아니고, 모델이 그 경로를 알면 다음번에 도구 대신 그 파일을 직접 고치려 든다.
 */
async function runSaveRunCommands(
  ports: McpToolPorts,
  projectId: string,
  root: string,
  args: Record<string, unknown>,
): Promise<string> {
  const saved = await saveRunCommands(ports.runListDir(), root, runCommandsInput(args))
  ports.runListChanged(projectId)

  const list = saved.entries.map((entry) => `${entry.name}(\`${entry.command}\`)`).join(' · ')
  const verb = saved.replaced ? '고쳐 적었습니다' : '적었습니다'
  return `이 프로젝트의 실행 목록에 ${saved.entries.length}개를 ${verb}: ${list}. 목록은 앱이 프로젝트별로 기억하고 사이드바 「실행」 패널에 그대로 뜹니다. **아무것도 실행하지 않았습니다** — 사용자가 그 패널에서 ▶ 로 띄웁니다. 지금 바로 돌려야 하는 것이 있으면 run_project 를 따로 부르세요.`
}
