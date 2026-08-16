// 드로어의 탭 목록 — **탭 하나가 pty 하나다** (설계 2026-08-16 §1 A안).
//
// 순수 함수로 빼 둔 이유는 `drawerKeys.ts`·`composerArrowKeys.ts` 와 같다: 이름이 붙을 만한
// 판단이고, 훅 안에 두면 렌더 없이 시험할 수 없다.
//
// **로그를 본문 탭이 아니라 드로어에 두는 이유**(B안을 버린 근거)는 설계 §1 에 있고, 그중
// 하나가 여기 코드에 그대로 드러난다: 본문 탭은 프로젝트를 옮기면 비워지는데(`useOpenFiles`)
// 프로세스는 살아 있어 *"탭이 없어졌으니 서버도 죽은 줄"* 로 읽힌다. 그래서 이 표는
// **프로젝트마다 따로** 산다 — 옮겼다 돌아오면 그대로다.

/**
 * 셸 칸의 이름. main 쪽 정본은 `electron/pty/ptyPool.ts` 의 같은 이름이고,
 * 거기서는 **되찾기 규칙**이 이 값에 걸린다 (앱을 껐다 켜도 남기는 유일한 칸).
 *
 * 값을 한 벌로 합치지 않는다 — 렌더러가 electron/ 을 import 하지 않는다.
 * 두 벌이 갈리면 셸 칸이 매번 새로 뜨는 것으로 드러나고, `multiplex.test.ts` 의
 * 「되찾기는 이름별로 갈린다」가 main 쪽을 잠근다.
 */
export const SHELL_PANE = 'shell'

/** 못 닫는 칸. 셸은 드로어 그 자체라 ✕ 가 없다 — 접는 것(⌘↑)과 다른 일이 아니다. */
export const PERMANENT_PANES: readonly string[] = [SHELL_PANE]

export interface PaneTabs {
  /** 왼쪽부터의 순서. 셸이 언제나 맨 앞이다 */
  names: string[]
  /** 지금 보고 있는 칸 */
  active: string
}

export const initialTabs: PaneTabs = { names: [SHELL_PANE], active: SHELL_PANE }

/**
 * 새 셸 칸 하나. **빈 번호를 다시 쓴다** — 열고 닫기를 반복해도 이름이 `shell-27` 로
 * 자라지 않는다. 이름은 서버의 pty 제목이 되므로(`paneServerTitle`) 눈에 보이는 값이다.
 */
export function addPane(tabs: PaneTabs): PaneTabs {
  let index = 2
  while (tabs.names.includes(`${SHELL_PANE}-${index}`)) index += 1
  const name = `${SHELL_PANE}-${index}`
  return { names: [...tabs.names, name], active: name }
}

/**
 * 탭을 닫는다 — **부르는 쪽이 프로세스도 멈춘다** (`closeShellPane`).
 *
 * 보고 있던 탭을 닫으면 **왼쪽**으로 간다. 오른쪽이 아닌 이유는 셸이 맨 앞이라 왼쪽이
 * 언제나 있기 때문이다 — 오른쪽으로 가면 마지막 탭을 닫을 때 갈 곳이 없어 갈래가 하나 는다.
 */
export function removePane(tabs: PaneTabs, name: string): PaneTabs {
  if (PERMANENT_PANES.includes(name)) return tabs
  const at = tabs.names.indexOf(name)
  if (at === -1) return tabs
  const names = tabs.names.filter((each) => each !== name)
  return { names, active: tabs.active === name ? (names[at - 1] ?? SHELL_PANE) : tabs.active }
}

/**
 * 이름을 가진 칸 하나를 열어 앞에 놓는다. **이미 있으면 만들지 않고 고르기만 한다** —
 * `run_project` 가 이미 돌고 있는 것을 다시 부를 때 같은 이름의 탭이 둘이 되면 안 된다.
 *
 * `addPane` 과 갈리는 지점은 **이름을 누가 짓는가**다. 저쪽은 "+" 를 누른 사용자를 위해
 * 빈 번호를 찾아 짓고, 이쪽은 부르는 쪽이 준 이름을 그대로 쓴다 (main 의 pty 제목과 같은
 * 값이어야 한다 — `electron/pty/ptyPool.ts` 의 `paneServerTitle`).
 */
export function openPane(tabs: PaneTabs, name: string): PaneTabs {
  if (tabs.names.includes(name)) return { ...tabs, active: name }
  return { names: [...tabs.names, name], active: name }
}

export function selectPane(tabs: PaneTabs, name: string): PaneTabs {
  return tabs.names.includes(name) ? { ...tabs, active: name } : tabs
}

/**
 * 들어온 프레임이 **이 칸의 것인가.**
 *
 * `drawerKeys.ts`·`composerArrowKeys.ts` 와 같은 자리·같은 이유로 컴포넌트 밖에 있다 —
 * "이건 누구 것인가" 는 이름이 붙을 만한 판단이고, 틀리면 **남의 출력이 이 화면에 찍힌다.**
 * 그런데 `DrawerTerminal` 은 진짜 xterm 을 세워야 해서 렌더 시험이 없다.
 *
 * 축이 둘이고 근거가 다르다:
 *   · `projectId` — 프로젝트를 옮기는 순간 도착한 이전 프로젝트의 출력이 섞이면 안 된다
 *     (main 이 겉봉을 씌우는 이유와 같다)
 *   · `name` — 한 프로젝트 안에서도 칸이 여럿이다. 출력은 채널 하나로 몰려 오므로
 *     여기서 안 가르면 개발 서버 로그가 셸 화면에 함께 찍힌다
 */
export function belongsToPane(
  frame: { name: string },
  from: string,
  pane: { projectId: string; name: string },
): boolean {
  return from === pane.projectId && frame.name === pane.name
}

/**
 * 화면에 적는 이름. 이름 자체(`shell-2`)는 pty 를 잇는 열쇠지 사람에게 보일 글이 아니다.
 *
 * `run_project` 가 여는 칸의 이름은 모델이 지은 것(`dev`·`test`)이라 **그대로 보여주는
 * 편이 낫다** — 그래서 셸 계열만 번역한다. (그 이름을 AGENTS.md 에서 읽어 오는 길은
 * 아직 없다. 지금은 도구 인자로 온다 — `electron/mcp/runProject.ts`.)
 */
export function tabLabel(name: string): string {
  if (name === SHELL_PANE) return '셸'
  const shellIndex = name.startsWith(`${SHELL_PANE}-`) ? name.slice(SHELL_PANE.length + 1) : null
  return shellIndex === null ? name : `셸 ${shellIndex}`
}
