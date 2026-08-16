// 셸 드로어가 오가는 값들. 이 레포 관례대로 **payload 객체 + 타입**이지 위치 인자가 아니다.
//
// ## `name` — 한 프로젝트에 pty 가 여럿이다
//
// 예전에는 프로젝트당 pty 가 하나라 이름이 필요 없었다. 그래서 개발 서버처럼 **안 끝나는
// 프로세스**를 띄우면 셸 칸이 그대로 잠겼다 — 실행·로그 기능이 막혀 있던 자리가 여기다
// (설계 `docs/superpowers/specs/2026-08-16-run-and-logs-design.md` §5).
//
// **탭 하나가 pty 하나이고, `name` 이 그 둘을 잇는 열쇠다.** 셸 칸의 이름은 `shell`
// (`src/state/drawerTabs.ts` 의 `SHELL_PANE`), 그 밖은 화면이 짓는다.
//
// projectId 는 **나가는 프레임과 떠나는 프레임에만** 있다. 들어오는 요청은 여전히 main 이
// 활성 프로젝트로 푼다 (`electron/pty/drawerBridge.ts`) — 사용자가 키를 치는 칸은 언제나
// 지금 보고 있는 프로젝트의 것이다.

/** 그 이름의 칸을 편다. 없으면 만들고, 서버에 이미 있으면 되찾는다. */
export interface PtyOpenPayload {
  name: string
}

/** 드로어를 편 결과. 실패 사유는 그대로 화면에 뜬다 — 빈 터미널만 보이면 사용자가 자기 탓으로 여긴다. */
export interface PtyOpenResult {
  ok: boolean
  error?: string
}

/**
 * 사이드바 「실행」 패널의 ▶ — 그 이름의 칸에서 명령을 **돌린다** (`PtyOpenPayload` 와 갈리는
 * 지점은 개행이다).
 *
 * **명령은 화면이 싣는다.** 화면이 들고 있는 것은 **자기가 그려 준 목록**이다
 * (`shared/run/runList.ts` 의 그 판). main 이 이름만 받아 저장소를 다시 읽으면 화면이
 * 보여 준 줄과 실제로 도는 명령이 갈릴 수 있다: 사용자가 목록을 보고 ▶ 를 누른 그 순간
 * 사이에 모델이 목록을 고쳐 적었으면, 사용자는 자기가 안 고른 것을 띄우게 된다.
 * (목록을 읽는 쪽이 렌더러에서 main 으로 옮겨 간 뒤에도 이 근거는 그대로다 —
 * 갈리는 것은 「누가 읽나」가 아니라 「언제 읽나」다.)
 */
export interface PtyRunPayload {
  name: string
  command: string
}

/**
 * ▶ 의 결과. **`started` 가 거짓이면 이미 돌고 있던 것**이고 우리는 아무것도 안 했다
 * (설계 §3 「겹쳐 띄우지 않는다」 — 화면은 그 탭으로 옮겨 가기만 한다).
 */
export type PtyRunResult = { ok: true; started: boolean } | { ok: false; error: string }

/** 사용자가 누른 키. **원시 바이트다** — JSON 봉투로 감싸면 그 JSON 이 셸에 타이핑된다 (실측). */
export interface PtyInputPayload {
  name: string
  data: string
}

export interface PtyResizePayload {
  name: string
  rows: number
  cols: number
}

/**
 * 그 칸에서 손을 뗀다 — **떠나는 쪽이 자기 신원을 말한다.**
 *
 * 이 프레임이 나가는 유일한 경로가 **프로젝트를 옮길 때**인데, 그 시점에 main 의 활성
 * 프로젝트는 **이미 옮겨 간 쪽**이다. 신원을 안 실으면 main 이 "떠나온 A" 대신 "도착한 B" 를
 * 정리해서, A 의 소켓이 안 닫히고 표에 남는다 — 옮겨 다닐수록 쌓인다 (design-audit 경고 2).
 *
 * 나가는 프레임에 겉봉을 씌운 것과 같은 이유다: 어느 프로젝트 것인지를 **보내는 쪽이 안다.**
 *
 * 칸이 여럿이 되면서 `name` 이 함께 온다. 칸마다 따로 언마운트되므로 프레임도 칸마다 하나다.
 */
export interface PtyDetachPayload {
  projectId: string
  name: string
}

/**
 * 탭을 닫았다 — **프로세스도 멈춘다** (`detach` 와 갈리는 지점이다).
 *
 * 접기(⌘↑)·프로젝트 이동은 `detach` 이고 셸은 살아 있다. 이쪽은 사용자가 ✕ 를 눌러
 * "이건 이제 필요 없다" 고 말한 것이라 서버의 pty 를 지운다 — 안 지우면 띄운 개발 서버가
 * 화면에서만 사라진 채 계속 돈다.
 */
export interface PtyClosePayload {
  projectId: string
  name: string
}

export interface PtyDataPayload {
  name: string
  chunk: string
}

/** 셸이 끝났다. 코드를 못 읽었으면 null (pty 가 이미 사라진 경우). */
export interface PtyExitPayload {
  name: string
  exitCode: number | null
}
