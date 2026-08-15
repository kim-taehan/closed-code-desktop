// 커넥터(MCP) 상태 — `kind=mcp_config` 봉투.
//
// **davis 때 이 봉투에 실리던 것은 개인 MCP 자격이었다** (ADR-021 / DC-1227,
// websocket/domains/mcp_config.py):
//   action = mcp_config_status | mcp_config_set | mcp_config_test 이고
//   요청·응답이 하나의 모양을 공유했다 (action 별로 모델을 나누지 않는다).
//   자격 값은 IDE → Runtime **한 방향으로만** 흘렀다 — 응답에는 값이 오지 않고 키 이름만 왔다.
//   원본 보관처가 IDE 쪽이고 노출 면적을 줄이려는 것이었다.
//
// **opencode 에는 그 개념이 통째로 없다.** MCP 서버는 사용자의 `opencode.json` 이 정하고,
// 앱이 자격을 밀어 넣을 자리가 없다 (opencode 의 인증은 `/mcp/:name/auth` 의 OAuth 로,
// 자격 스키마를 화면에 그리는 davis 방식과 다른 물건이다). 그래서 **봉투(kind/action)는 남기고
// payload 를 갈아 끼웠다** — 지금 실리는 것은 자격이 아니라 **연결 상태**다.
// 번역은 `electron/opencode/mcpConfig.ts` 가 하고, 그 파일이 실측 근거의 정본이다.
//
// 위 davis 규칙을 지우지 않고 남기는 이유: 필드가 왜 통째로 바뀌었는지가 어댑터의 설계 근거다.
// 없어진 필드는 `auth_mode`·`configured`·`credential_keys`·`credential_schema`·`oauth_*`·
// `policy_enabled` 다. 되살릴 일이 생긴다면 그건 davis 로 되돌아가는 것이지 opencode 확장이 아니다.

/**
 * opencode `MCPStatus` 의 status (1.18.18 `/doc` 전수 — **다섯 갈래다**).
 *
 * 화면이 그리는 것은 앞의 셋이고, 뒤의 둘은 원격 서버가 OAuth 를 요구할 때 온다.
 * 모르는 값은 `unknown` 으로 접는다 — 버전이 갈래를 늘려도 목록에서 사라지면 안 된다.
 */
export type McpConnectionStatus =
  | 'connected'
  | 'failed'
  | 'disabled'
  | 'needs_auth'
  | 'needs_client_registration'
  | 'unknown'

/** 서버가 어떻게 붙는가. opencode 설정의 `type` 이다. */
export type McpTransport = 'local' | 'remote' | 'unknown'

export interface McpServerStatus {
  serverName: string
  status: McpConnectionStatus
  transport: McpTransport
  /** remote 면 주소, local 이면 실행 명령을 한 줄로 붙인 것. 설정을 못 읽으면 없다. */
  url?: string
  /** opencode 가 준 실패 원문. `failed`·`needs_client_registration` 에만 있다. */
  error?: string
  /**
   * 이 서버가 주는 도구 이름.
   *
   * **우리 서버(`open-code-desktop`)에만 채운다.** opencode 는 `GET /mcp` 에 도구를 안 싣고,
   * 남의 서버 도구를 알아낼 표면이 없다 — 모르는 것을 지어내지 않는다.
   */
  tools: string[]
}

export interface McpState {
  servers: McpServerStatus[]
  /** 목록을 못 받은 사유. 받았으면 빈 문자열이다. */
  message: string
}

export const EMPTY_MCP_STATE: McpState = { servers: [], message: '' }

/**
 * 응답을 안전한 모양으로 되돌린다.
 *
 * **payload 는 snake_case 다** — 이 도메인에 camelCase 별칭이 없다는 davis 규칙을 그대로 뒀다.
 * 모양이 어긋나도 화면이 깨지지 않게 항목 단위로 걸러 담는다.
 */
export function parseMcpState(data: unknown): McpState {
  const source = asRecord(data)
  const servers = Array.isArray(source['servers']) ? source['servers'] : []

  return {
    servers: servers.map(toServer).filter((server): server is McpServerStatus => server !== null),
    message: typeof source['message'] === 'string' ? source['message'] : '',
  }
}

function toServer(value: unknown): McpServerStatus | null {
  const source = asRecord(value)
  const name = source['server_name']
  // 이름이 없으면 가리킬 대상이 없다
  if (typeof name !== 'string' || name === '') return null

  const url = source['url']
  const error = source['error']

  return {
    serverName: name,
    status: toStatus(source['status']),
    transport: toTransport(source['transport']),
    tools: toStrings(source['tools']),
    ...(typeof url === 'string' && url !== '' ? { url } : {}),
    ...(typeof error === 'string' && error !== '' ? { error } : {}),
  }
}

const STATUSES: readonly string[] = [
  'connected',
  'failed',
  'disabled',
  'needs_auth',
  'needs_client_registration',
]

function toStatus(value: unknown): McpConnectionStatus {
  return typeof value === 'string' && STATUSES.includes(value)
    ? (value as McpConnectionStatus)
    : 'unknown'
}

function toTransport(value: unknown): McpTransport {
  return value === 'local' || value === 'remote' ? value : 'unknown'
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
