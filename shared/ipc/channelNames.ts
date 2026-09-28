// IPC 채널 이름 등록부. `channels.ts` 가 배럴로 re-export 하므로
// 소비자는 여전히 `shared/ipc/channels` 에서 `Channel` 을 가져온다.
//
// **도메인별로 쪼개 spread 로 합치지 않는다.**
// 객체 리터럴 하나일 때는 키가 겹치면 컴파일이 막는다. 여러 파일로 갈라
// `{ ...SESSION, ...GIT }` 로 합치면 파일이 다른 중복 키가 조용히 덮어써진다 —
// 채널 등록부에서 그건 추적이 거의 불가능한 버그가 된다.
//
// **그래서 갈랐을 때는 `disjoint` 로만 합친다 (2026-09-22).** 300줄 상한에 닿아 확장 채널을
// `extensionChannelNames.ts` 로 옮겼다. `disjoint` 는 두 번째 묶음에 첫 묶음의 키가 있으면
// **타입 오류**를 낸다 — 한 덩어리일 때 컴파일러가 막아 주던 것을 그대로 지킨다.
// 값(문자열)이 겹치는 것은 컴파일러가 원래 못 보고, 그건 `channelNames.test.ts` 가 본다.
import { EXTENSION_CHANNELS } from './extensionChannelNames'

/**
 * 키가 겹치지 않는 두 묶음을 하나로. 겹치면 `B` 의 그 키가 `never` 를 요구해 컴파일이 멈춘다.
 * 런타임에도 한 번 더 본다 — 타입을 `as` 로 누른 호출이 있어도 조용히 덮이지 않게.
 */
export function disjoint<A extends Record<string, string>, B extends Record<string, string> & { [K in keyof A]?: never }>(
  a: A,
  b: B,
): A & B {
  const shared = Object.keys(b).filter((key) => key in a)
  if (shared.length > 0) throw new Error(`채널 키가 겹칩니다: ${shared.join(', ')}`)
  return { ...a, ...b }
}

const CORE_CHANNELS = {
  /** renderer → main: 세션 시작 요청 */
  SESSION_START: 'session:start',
  /** renderer → main: 채팅 전송 */
  CHAT_SEND: 'chat:send',
  /** renderer → main: 도구 승인 응답 */
  APPROVAL_RESPOND: 'approval:respond',
  /** renderer → main: HIL 질문 답 / 계획 승인 응답 */
  QUESTION_RESPOND: 'question:respond',
  PLAN_RESPOND: 'plan:respond',
  /** renderer → main: 진행 중인 응답 취소 */
  CHAT_CANCEL: 'chat:cancel',
  /** renderer → main: 턴 리뷰 판정 */
  REVIEW_DECIDE: 'review:decide',
  /** renderer → main: 개인 MCP 자격 */
  MCP_STATUS: 'mcp:status',
  MCP_SET: 'mcp:set',
  MCP_TEST: 'mcp:test',
  /** main → renderer: MCP 서버 상태 */
  MCP_STATE: 'mcp:state',
  /**
   * main → renderer: **데스크톱 MCP 서버의 `open_file` 도구가 파일을 열라고 했다.**
   *
   * ⚠️ 위의 `MCP_*` 넷과 **다른 뜻의 MCP** 다. 저쪽은 앱이 MCP 클라이언트로서 개인
   * 자격증명을 다루는 화면(`McpDialog`)이고, 이쪽은 앱이 MCP **서버**가 되어 에이전트가
   * 앱을 조작하는 쪽이다 (`electron/mcp/`). 이름을 갈라 두 뜻이 섞이지 않게 한다.
   */
  DESKTOP_MCP_OPEN_FILE: 'desktopMcp:openFile',
  /**
   * main → renderer: **데스크톱 MCP 서버의 `open_terminal` 도구가 셸 칸을 펴라고 했다.**
   *
   * 화면이 하는 일은 **칸을 펴는 것뿐**이다. 채울 명령을 pty 에 넣는 것은 main 이 한다
   * (`electron/pty/drawerBridge.ts` 의 `fill`) — 소켓이 언제 열리는지는 main 만 알고,
   * 열리기 전에 쓴 바이트는 흔적 없이 사라진다 (`PtySocket.write` 실측).
   */
  DESKTOP_MCP_OPEN_TERMINAL: 'desktopMcp:openTerminal',
  /**
   * main → renderer: **`run_project` 도구가 그 이름의 칸을 띄웠다** (`electron/mcp/runProject.ts`).
   *
   * 화면이 하는 일은 **탭을 만들어 앞에 놓는 것뿐**이다. pty 를 띄우고 명령을 넣는 일은
   * 이 프레임보다 **먼저** main 이 끝낸다 (`appWiring.ts` — 순서를 뒤집으면 화면이 연 칸을
   * main 이 "이미 돌고 있다" 로 읽어 명령이 영영 안 들어간다).
   *
   * 탭이 반드시 떠야 하는 이유는 **멈추는 문이 거기뿐**이기 때문이다 — 정지·재시작은
   * 사람만 하고(설계 §3), 사람이 쓰는 문이 탭의 ✕ 다.
   */
  DESKTOP_MCP_RUN_PROJECT: 'desktopMcp:runProject',
  MODEL_OPTIONS_REQUEST: 'llm:modelOptions', // renderer → main: 모델 스위처 상태 재조회 (DC-1322)
  MODEL_STATE: 'llm:modelState', // main → renderer: 모델 스위처 상태 (llm_config status/models 결과)
  NOTIFICATION: 'notification:push',
  /** main → renderer: 턴 리뷰 목록 */
  REVIEW_STATE: 'review:state',
  /** renderer → main: 새 대화 */
  CHAT_RESET: 'chat:reset',
  CHAT_LOCAL_NOTICE: 'chat:localNotice', // 로컬 안내 한 쌍을 대화에 — runtime 을 거치지 않는다 (이스터에그)
  /** renderer → main: 권한 모드 변경 */
  PERMISSION_MODE_SET: 'permission:set',
  /** main → renderer: 권한 모드 확정 */
  PERMISSION_MODE_CHANGED: 'permission:changed',
  WORKING_DIR_CHANGED: 'workingDir:changed', // main → renderer: 현재 세션 작업 경로 (ADR-036)
  /** renderer → main: 이력 조작 */
  HISTORY_LIST: 'history:list',
  HISTORY_LOAD: 'history:load',
  HISTORY_REMOVE: 'history:remove',
  HISTORY_RENAME: 'history:rename',
  /** main → renderer: 이력 상태 */
  HISTORY_STATE: 'history:state',
  /** main → renderer: 세션 상태 변화 */
  SESSION_STATE: 'session:state',
  /** main → renderer: 턴 이벤트 */
  TURN_EVENT: 'turn:event',
  /** main → renderer: 메시지 스냅샷 (화면이 실제로 그리는 것) */
  CHAT_SNAPSHOT: 'chat:snapshot',
  /** renderer → main: 프로젝트 조작 */
  PROJECT_PICK: 'project:pick',
  PROJECT_OPEN: 'project:open',
  PROJECT_CLOSE: 'project:close',
  PROJECT_ACTIVATE: 'project:activate',
  PROJECT_RENAME: 'project:rename',
  PROJECT_FAVORITE: 'project:favorite',
  /** 탭 끌어 옮기기 — 새 순서 전체를 보낸다. 열린 것의 순열이 아니면 main 이 버린다 */
  PROJECT_REORDER: 'project:reorder',
  /** renderer → main: 지금 목록을 달라 (구독을 놓쳐도 화면이 비지 않게) */
  PROJECT_LIST: 'project:list',
  /** main → renderer: 프로젝트 목록 상태 */
  PROJECT_STATE: 'project:state',
  /** renderer → main: `/` 목록 — opencode 의 명령·MCP·스킬 전부 */
  COMMAND_LIST: 'command:list',
  /** renderer → main: opencode 자신의 프로젝트 설정 파일과 서버가 합친 유효 설정 */
  OPENCODE_CONFIG_READ: 'opencodeConfig:read',
  /** renderer → main: 그 설정 파일을 쓴다. 깨진 JSON 은 거절된다 */
  OPENCODE_CONFIG_WRITE: 'opencodeConfig:write',
  /** renderer → main: opencode instance 를 버려 설정을 다시 읽힌다 + 재연결 */
  OPENCODE_CONFIG_RELOAD: 'opencodeConfig:reload',
  /** renderer → main: 프로젝트 파일 목록 (빠른 열기) */
  PROJECT_LIST_FILES: 'project:listFiles',
  /** renderer → main: 내용 검색 */
  PROJECT_SEARCH: 'project:search',
  /** renderer → main: `!명령` 로컬 실행 */
  SHELL_RUN: 'shell:run',
  /**
   * 하단 셸 드로어 (⌘↓ 열기 / ⌘↑ 접기).
   *
   * 셸은 **opencode 서버가 굴린다** (`/api/pty`) — 앱은 바이트를 나르기만 한다.
   * 그래서 `SHELL_RUN`(`!명령` 한 번 실행)과 성격이 다르다: 저쪽은 결과를 대화에 남기고,
   * 이쪽은 살아 있는 셸에 붙는다.
   *
   * 렌더러가 WS 를 직접 열지 않는 이유는 `electron/pty/drawerBridge.ts` 머리말 (CSP).
   * projectId 를 renderer 가 보내지 않는다 — main 이 활성 프로젝트로 푼다.
   *
   * **모든 프레임에 `name` 이 실린다** — 한 프로젝트에 칸이 여럿이고 탭 하나가 pty 하나다
   * (`electron/pty/ptyPool.ts`). 예전에는 프로젝트당 하나라 이름이 필요 없었고, 그래서
   * 개발 서버를 띄우면 셸 칸이 잠겼다.
   */
  PTY_OPEN: 'pty:open',
  PTY_INPUT: 'pty:input',
  PTY_RESIZE: 'pty:resize',
  /** 드로어를 접는다. **셸은 죽이지 않는다** — 다시 펴면 스크롤백째 돌아온다 */
  PTY_DETACH: 'pty:detach',
  /** 탭의 ✕ — **프로세스도 멈춘다.** `PTY_DETACH` 와 갈리는 지점이다 (`PtyClosePayload`) */
  PTY_CLOSE: 'pty:close',
  /** main → renderer: 터미널 바이트 (겉봉 있음 — 프로젝트를 옮기면 남의 출력이 섞이면 안 된다) */
  PTY_DATA: 'pty:data',
  /** main → renderer: 셸이 끝났다. 종료 코드는 프레임에 없어 main 이 다시 물어 온다 */
  PTY_EXIT: 'pty:exit',
  /**
   * renderer → main: **사이드바 「실행」 패널의 ▶** — 그 칸에서 명령을 돌린다.
   * `PTY_OPEN` 과 갈리는 지점은 **개행**이고, `run_project` 도구와 **같은 함수**를 탄다
   * (`PtyDrawerBridge.run`) — 문이 둘이어도 「겹쳐 띄우지 않는다」는 한 곳에서 판정한다.
   *
   * ⚠️ **화면은 이 왕복이 끝난 뒤에 탭을 만든다.** 먼저 만들면 그 탭이 같은 이름으로 칸을 열고
   * (`PTY_OPEN`) main 이 「이미 돌고 있다」로 읽어 명령이 영영 안 들어간다 (`appWiring.ts`).
   */
  PTY_RUN: 'pty:run',
  // 사이드바 「실행」 패널의 둘. **근거는 `runBridgeSurface.ts` 에 있다** — 이 파일이 300줄
  // 상한에 붙어 있어 설명을 그쪽으로 옮겼다(둘 다 그 표면의 메서드라 자리가 어색하지도 않다).
  /** main → renderer: 그 프로젝트의 실행 목록이 바뀌었다 — **목록은 안 싣는다** */
  RUN_LIST_CHANGED: 'run:listChanged',
  /** renderer → main: 이 프로젝트의 실행 목록 (앱 저장소에서 읽는다 · `stale` 판정 포함) */
  RUN_LIST_READ: 'run:listRead',
  /** renderer → main: 대화에 붙일 것을 고른다 (이미지·파일 구분 없이) */
  ATTACH_PICK: 'attach:pick',
  ATTACH_RESOLVE: 'attach:resolve', // 드래그드롭 경로 판별 (다이얼로그 없이)
  NOTIFY_TASK_DONE: 'notify:taskDone', // 비활성 창에서 작업 끝 — 설정 켜져 있으면 OS 알림
  CHAT_RENAME_CURRENT: 'chat:renameCurrent', // /rename — main 이 현재 chat_id 로 rename
  /** renderer → main: 프로젝트 디렉토리 한 겹 읽기 */
  PROJECT_READ_DIR: 'project:readDir',
  /** renderer → main: 파일 덮어쓰기 */
  PROJECT_WRITE_FILE: 'project:writeFile',
  /** renderer → main: 파일 내용 읽기 */
  PROJECT_READ_FILE: 'project:readFile',
  PROJECT_OPEN_IN_OS: 'project:openInOs',
  PROJECT_FS_ACTION: 'project:fsAction',
  /** renderer → main: 앱 전역 설정 읽기/쓰기 */
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  /** renderer → main: 쓸 모델이 붙어 있는지 (Doctor 2단계) */
  MODEL_CHECK: 'model:check',
  /** renderer → main: opencode 서버가 떠 있는지 (Doctor 1단계) */
  SERVER_PING: 'server:ping',
  /**
   * renderer → main: **이 프로젝트의 서버를 우리가 띄웠나** (주소·pid 포함).
   *
   * ping 과 다른 물음이다. ping 은 *"그 주소가 응답하나"* 이고 이쪽은 *"우리 것인가"* 다 —
   * 「다시 시작」을 줄지 「서버 시작」을 줄지가 여기서 갈린다. 우리 것이 아니면 못 죽인다.
   */
  SERVER_STATUS: 'server:status',
  /** renderer → main: 서버 시작·다시 시작·종료. 현장 사용자에게는 터미널이 없다 */
  SERVER_CONTROL: 'server:control',
  /** renderer → main: 지금 프로젝트만 다시 붙는다 */
  SESSION_RECONNECT: 'session:reconnect',
  /** renderer → main: runtime 프로세스를 새로 띄우고 전부 다시 붙는다 */
  RUNTIME_RESTART: 'runtime:restart',
  /** renderer → main: 연결 진단 (런타임 + Admin) */
  SESSION_DIAGNOSE: 'session:diagnose',
  /** renderer → main: 쌓인 로그 읽기 / 지우기 */
  LOG_LIST: 'log:list',
  LOG_CLEAR: 'log:clear',
  /** main → renderer: 새로 들어온 로그 한 줄 */
  LOG_APPEND: 'log:append',
  /** renderer → main: 소스 관리 — 조회 */
  GIT_STATE: 'git:state',
  GIT_FILE_DIFF: 'git:fileDiff',
  /** renderer → main: 원격까지 확인하고 다시 읽는다 (fetch 동반) */
  GIT_REFRESH: 'git:refresh',
  /** renderer → main: 소스 관리 — 변경 행동 */
  GIT_STAGE: 'git:stage',
  GIT_UNSTAGE: 'git:unstage',
  GIT_REVERT: 'git:revert',
  GIT_COMMIT: 'git:commit',
  GIT_PUSH: 'git:push',
  GIT_PULL: 'git:pull',
  /** renderer → main: 소스 관리 — 묶음 행동 (전부 담기 / 인덱스 통째로 비우기) */
  GIT_STAGE_ALL: 'git:stageAll',
  GIT_UNSTAGE_ALL: 'git:unstageAll',
  /** renderer → main: 소스 관리 — 덩어리(hunk) 하나만 담기 / 되돌리기 */
  GIT_STAGE_HUNK: 'git:stageHunk',
  GIT_REVERT_HUNK: 'git:revertHunk',
  /** renderer → main: 직전 커밋을 새 메시지로 다시 만든다 / 커밋만 무른다 (--soft) */
  GIT_AMEND: 'git:amend',
  GIT_UNDO_COMMIT: 'git:undoCommit',
  /**
   * renderer → main: 히스토리·브랜치·임시저장 — **조회**.
   *
   * `GIT_STATE` 에 얹지 않는다. 상태는 행동마다 다시 읽혀 밀리는 값이고 이쪽은
   * 그 화면을 열 때만 묻는 값이다 (`shared/git/gitCommit.ts` 머리말).
   */
  GIT_LOG: 'git:log',
  GIT_COMMIT_DETAIL: 'git:commitDetail',
  GIT_BRANCHES: 'git:branches',
  GIT_STASHES: 'git:stashes',
  GIT_STASH_SHOW: 'git:stashShow',
  /** renderer → main: 브랜치 — 전환·생성·원격 받아오기·병합 */
  GIT_SWITCH_BRANCH: 'git:switchBranch',
  GIT_CREATE_BRANCH: 'git:createBranch',
  GIT_TRACK_BRANCH: 'git:trackBranch',
  GIT_MERGE_BRANCH: 'git:mergeBranch',
  /** renderer → main: 브랜치 삭제. **안전/강제를 채널로 가른다** — 플래그 한 글자 차이로 잘못 부르지 않게 */
  GIT_DELETE_BRANCH: 'git:deleteBranch',
  GIT_FORCE_DELETE_BRANCH: 'git:forceDeleteBranch',
  /** renderer → main: 임시저장 — 치우기·복원·버리기 (복원과 버리기를 갈라 둔다) */
  GIT_STASH_PUSH: 'git:stashPush',
  GIT_APPLY_STASH: 'git:applyStash',
  GIT_DROP_STASH: 'git:dropStash',
  /** main → renderer: 바뀐 git 상태 */
  GIT_STATE_PUSH: 'git:statePush',
} as const

// 확장 채널은 `extensionChannelNames.ts` 에 산다. 합치는 것은 `disjoint` 하나뿐이다 (머리말).
export const Channel = disjoint(CORE_CHANNELS, EXTENSION_CHANNELS)
export type Channel = (typeof Channel)[keyof typeof Channel]
