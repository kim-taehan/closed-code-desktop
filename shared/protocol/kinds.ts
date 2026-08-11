// runtime WebSocket 의 kind/action 상수.
// 출처: davis-code-runtime/src/app/websocket/protocol.py:24-145
// M1 이 실제로 주고받는 것만 둔다. 나머지는 필요해질 때 추가한다.

export const Kind = {
  MCP_CONFIG: 'mcp_config',
  LLM_CONFIG: 'llm_config',
  SYSTEM: 'system',
  AUTH: 'auth',
  WORKSPACE: 'workspace',
  CHAT: 'chat',
  CHAT_HISTORY: 'chat_history',
  DIFF: 'diff',
  NOTIFICATION: 'notification',
} as const

export type Kind = (typeof Kind)[keyof typeof Kind]

export const Action = {
  MCP_CONFIG_STATUS: 'mcp_config_status',
  MCP_CONFIG_SET: 'mcp_config_set',
  MCP_CONFIG_TEST: 'mcp_config_test',
  // llm_config — 모델 스위처가 쓰는 status/models 만 (BYOK set/test 는 미구현. DC-1322 미러)
  LLM_CONFIG_STATUS: 'llm_config_status',
  LLM_CONFIG_MODELS: 'llm_config_models',
  // system
  CONNECTED: 'connected',
  PING: 'ping',
  PONG: 'pong',
  ANNOUNCEMENT: 'announcement',
  // auth
  AUTH_REQUEST: 'auth_request',
  AUTH_STATE: 'auth_state',
  // workspace
  WORKSPACE_SYNC: 'workspace_sync',
  WORKSPACE_STATE: 'workspace_state',
  SET_PERMISSION_MODE: 'set_permission_mode',
  PERMISSION_MODE_CHANGED: 'permission_mode_changed',
  WORKING_DIR_STATE: 'working_dir_state',
  // chat (요청)
  CHAT_REQUEST: 'chat_request',
  STREAM_CANCEL: 'stream_cancel',
  TOOL_APPROVAL_RESPONSE: 'tool_approval_response',
  // chat (HIL 응답) — ask_user·propose_plan 인터럽트에 답한다 (domains/chat.py:75-92)
  USER_ANSWER: 'user_answer',
  PLAN_APPROVAL_RESPONSE: 'plan_approval_response',
  // chat (응답)
  STREAM_START: 'stream_start',
  STREAM_CHUNK: 'stream_chunk',
  STREAM_END: 'stream_end',
  // chat_history — ⚠️ 이 도메인은 snake_case 가 정본이다 (별칭 없음)
  CHAT_HISTORY_LIST: 'chat_history_list',
  CHAT_HISTORY_LOAD: 'chat_history_load',
  CHAT_HISTORY_LOAD_COMPLETE: 'chat_history_load_complete',
  CHAT_HISTORY_ADD: 'chat_history_add',
  CHAT_HISTORY_REMOVE: 'chat_history_remove',
  CHAT_HISTORY_RENAME: 'chat_history_rename',
  CHAT_HISTORY_TITLE: 'chat_history_title',
  // diff — V2 턴 리뷰 (ADR-0002). camelCase 별칭 도메인이다.
  TURN_CHANGES: 'turn_changes',
  TURN_STATUS: 'turn_status',
  TURN_ACK: 'turn_ack',
  TURN_REJECT: 'turn_reject',
  TURN_FETCH_CONTENT: 'turn_fetch_content',
  CHAT_REWOUND: 'chat_rewound',
  // notification — s2c push 전용. 요청 액션이 없다 (ADR-053)
  NOTIFY: 'notify',
  // 공통 응답
  ACK: 'ack',
  ERROR: 'error',
} as const

export type Action = (typeof Action)[keyof typeof Action]

/** auth_state.data.state — constants.py:25-29 */
export const AuthState = {
  VALID: 'valid',
  INVALID: 'invalid',
  EXPIRED: 'expired',
} as const

export type AuthState = (typeof AuthState)[keyof typeof AuthState]

/** workspace_state.data.state — 소문자다. workspace_service.py:154-189 */
export const WorkspaceState = {
  NOT_READY: 'not_ready',
  READY: 'ready',
} as const

export type WorkspaceState = (typeof WorkspaceState)[keyof typeof WorkspaceState]

/**
 * 전역 동작 모드 (ADR-011 §4).
 *   default — 룰 기반 평가. 편집·실행 도구에서 승인을 묻는다
 *   plan    — 읽기 전용. 탐색·계획 단계
 *
 * **davis 에는 `acceptEdits`(편집 도구 자동 승인)가 하나 더 있었다.** opencode 로 옮기며
 * 뺐다 — 모드에 해당하는 것이 opencode 에서는 primary 에이전트인데(`opencode/agents.ts`),
 * build·plan 둘뿐이고 acceptEdits 에 해당하는 에이전트가 없다. opencode 에서 편집 자동
 * 승인은 서버 설정 파일의 permission 규칙이라 데스크탑이 세션 단위로 켤 수 없다.
 *
 * **고를 수 없는 것을 목록에 두지 않는다.** 남겨 두면 켜 놓고 "자동 승인 중" 이라고 믿는데
 * 실제로는 매번 승인을 묻거나(잘해야 성가심), 반대로 서버에 엉뚱한 에이전트 이름이 박힌다.
 */
export const PermissionMode = {
  DEFAULT: 'default',
  PLAN: 'plan',
} as const

export type PermissionMode = (typeof PermissionMode)[keyof typeof PermissionMode]

export const ALL_PERMISSION_MODES: readonly PermissionMode[] = Object.values(PermissionMode)

/**
 * 화면에 보여줄 이름. **영문 그대로 쓴다** —
 * runtime·vscode·IntelliJ 가 모두 이 이름으로 부르므로 번역하면 서로 다른 것처럼 보인다.
 */
export const PERMISSION_MODE_LABEL: Record<PermissionMode, string> = {
  default: 'default',
  plan: 'plan',
}

/** 모드를 한눈에 알아보게 하는 기호 */
export const PERMISSION_MODE_ICON: Record<PermissionMode, string> = {
  default: '⚡',
  plan: '🔒',
}

/**
 * 한 줄 설명. **문구를 줄이지 않는다** — plan 의 "편집 전" 은 정확한 진술이다.
 * opencode 의 plan 에이전트는 편집 도구를 **막을 뿐** 셸·탐색까지 막지는 않는다
 * ("Disallows all edit tools" — `GET /agent` 실측). "아무것도 안 한다" 로 줄이면
 * 명령이 도는 것을 보고 모드가 안 걸린 줄 안다.
 */
export const PERMISSION_MODE_HINT: Record<PermissionMode, string> = {
  default: '편집 전 승인을 요청',
  plan: '코드를 탐색하고 편집 전 계획을 수립',
}
