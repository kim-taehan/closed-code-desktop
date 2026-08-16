// 셸 칸 이름의 **한 벌짜리 정본**. 화면(`src/state/drawerTabs.ts`)·main(`electron/pty/ptyPool.ts`)·
// 도구 검사(`electron/mcp/runProject.ts`)가 전부 여기서 읽는다.
//
// **세 벌이던 자리다.** 안 합친 근거가 *"렌더러가 electron/ 을 import 하지 않는다"* 였는데,
// 그 근거는 `shared/` 를 배제하지 않는다 — 렌더러도 main 도 여기는 읽는다
// (`shared/ipc/ptyPayloads.ts` 가 이미 이 값을 주석으로 가리키고 있었다).
//
// **갈리면 조용히 깨진다**: 되찾기가 서버 pty 제목의 **완전 일치**로 도는데(`paneServerTitle`),
// 값이 한 벌만 바뀌면 셸 칸이 껐다 켤 때마다 새로 뜨고 예전 pty 는 아무도 못 찾는 채
// 서버에 쌓인다. 화면에는 "셸이 초기화됐다" 로만 보인다.

/** 셸 칸의 이름. 앱을 껐다 켜도 이 이름으로 되찾는 유일한 칸이다. */
export const SHELL_PANE = 'shell'

/**
 * 사용자의 셸 칸인가 — `shell` 과 `shell-2`·`shell-3`… 을 함께 본다.
 *
 * 「추가」로 늘어나는 칸이 `shell-N` 이라(`drawerTabs.ts` 의 `addPane`) **둘 다 사용자가 손으로
 * 치는 자리**이고, 그래서 `run_project` 가 거기에 명령을 밀어 넣지 않는다 — 밀어 넣으면
 * 사용자가 치던 줄에 섞이고, 안 끝나는 프로세스면 칸을 통째로 잠근다.
 */
export function isShellPane(name: string): boolean {
  return name === SHELL_PANE || name.startsWith(`${SHELL_PANE}-`)
}
