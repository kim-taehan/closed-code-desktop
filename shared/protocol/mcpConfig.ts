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
//
// **나가는 쪽에 자격이 실려도 버린다.** `mcp_config_set` 은 davis 계약상 `credentials` 를
// 실을 수 있고 화면은 `{}` 만 보내지만, 계약을 아는 다른 코드가 값을 실을 수 있다.
// 어댑터(`electron/opencode/mcpConfig.ts` 의 `applyEnabled`)는 `server_name`·`enabled` 만 읽는다 —
// 자격은 **opencode 로 전달되지 않고**(전달할 표면 자체가 없다) **로그로 남지 않고**
// **응답 payload 로 되돌아오지 않는다.** 오류로 올리지 않는 것은 화면이 안 보내는 필드 때문에
// 다이얼로그가 깨지면 안 되기 때문이고, 응답에 값을 안 싣는다는 davis 방향과도 어긋나지 않는다.

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
   * 이 서버가 주는 도구.
   *
   * **우리 서버(`closed-code-desktop`)에만 채운다.** opencode 는 `GET /mcp` 에 도구를 안 싣고,
   * 남의 서버 도구를 알아낼 표면이 없다 — 모르는 것을 지어내지 않는다.
   */
  tools: McpTool[]
}

/**
 * 도구 하나.
 *
 * 예전에는 **이름만** 실었다(`string[]`). 설명은 처음부터 있었는데
 * (`electron/mcp/toolSchemas.ts` 에 도구마다 한국어로 적혀 있다) 실어 보내는 자리에서
 * `.map((tool) => tool.name)` 으로 떨어뜨리고 있었다 — 화면에는 이름표만 남아, 무엇을
 * 하는 도구인지 알려면 소스를 열어야 했다.
 */
export interface McpTool {
  name: string
  /**
   * 무엇을 하는 도구인가. **없을 수 있다** — 도구는 MCP 규약상 설명이 선택이고,
   * 없는 것을 빈 문자열로 채우면 화면이 「설명이 있는데 비었다」로 그린다.
   */
  description?: string
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
    tools: toTools(source['tools']),
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

/**
 * 도구 목록.
 *
 * **글자만 온 것도 받는다.** 이 payload 를 만드는 자리가 예전에는 이름만 실었고
 * (`string[]`), 앱과 opencode 는 각자 갱신되므로 옛 모양이 한동안 함께 돈다.
 * 그때 목록을 통째로 버리면 「이 앱이 띄웠다」 표식(`McpSection` 의 `ours`)까지 사라져,
 * 서버 카드가 남의 서버처럼 보인다 — 설명만 없는 것과 결과가 다르다.
 *
 * 설명은 **빈 문자열이면 없는 것으로 본다.** 화면이 「설명이 있는데 비었다」로 그리는 것을
 * 막는 자리가 여기뿐이다 (`url`·`error` 와 같은 규칙).
 */
function toTools(value: unknown): McpTool[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return item === '' ? [] : [{ name: item }]
    const source = asRecord(item)
    const name = source['name']
    // 이름이 없으면 가리킬 도구가 없다 — 설명만 있는 줄은 그릴 수도 부를 수도 없다
    if (typeof name !== 'string' || name === '') return []
    const description = source['description']
    return [
      {
        name,
        ...(typeof description === 'string' && description !== '' ? { description } : {}),
      },
    ]
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
