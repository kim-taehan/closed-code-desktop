// 개인 MCP 자격 설정 (ADR-021 / DC-1227).
//
// **계약은 runtime 이 정한다** (websocket/domains/mcp_config.py):
//   kind=mcp_config, action = mcp_config_status | mcp_config_set | mcp_config_test
//   요청·응답이 하나의 모양을 공유한다 (action 별로 모델을 나누지 않는다)
//
// **자격 값은 한 방향으로만 흐른다.** IDE → Runtime 으로만 보내고,
// 응답에는 값이 절대 오지 않는다 — 키 이름만 온다.
// 원본 보관처는 IDE 쪽이고, 노출 면적을 줄이려는 것이다.
//
// 이 파일도 그 규칙을 따른다: 받은 것에 값이 있다고 가정하지 않는다.

/** 인증 방식. stdio 는 키 입력, 원격(SSE/HTTP)은 OAuth 로그인이다. */
export type McpAuthMode = 'credential_schema' | 'oauth'

export interface McpCredentialField {
  key: string
  required: boolean
}

export interface McpServerStatus {
  serverName: string
  authMode: McpAuthMode
  /** 개인 자격이 채워져 있는가 */
  configured: boolean
  /** 채워진 키의 **이름만**. 값은 오지 않는다. */
  credentialKeys: string[]
  credentialSchema: McpCredentialField[]
  oauthAuthenticated: boolean
  /** epoch seconds */
  oauthExpiresAt?: number
}

export interface McpState {
  servers: McpServerStatus[]
  /** 프로젝트가 개인 자격을 허용하는가. 꺼져 있으면 설정해도 쓰이지 않는다. */
  policyEnabled: boolean
  message: string
}

export const EMPTY_MCP_STATE: McpState = { servers: [], policyEnabled: false, message: '' }

/**
 * 응답을 안전한 모양으로 되돌린다.
 *
 * runtime 은 snake_case 로 준다 (이 도메인에는 camelCase 별칭이 없다).
 * 모양이 어긋나도 화면이 깨지지 않게 항목 단위로 걸러 담는다.
 */
export function parseMcpState(data: unknown): McpState {
  const source = asRecord(data)
  const servers = Array.isArray(source['servers']) ? source['servers'] : []

  return {
    servers: servers.map(toServer).filter((server): server is McpServerStatus => server !== null),
    policyEnabled: source['policy_enabled'] === true,
    message: typeof source['message'] === 'string' ? source['message'] : '',
  }
}

function toServer(value: unknown): McpServerStatus | null {
  const source = asRecord(value)
  const name = source['server_name']
  // 이름이 없으면 가리킬 대상이 없다
  if (typeof name !== 'string' || name === '') return null

  const schema = Array.isArray(source['credential_schema']) ? source['credential_schema'] : []
  const expires = source['oauth_expires_at']

  return {
    serverName: name,
    authMode: source['auth_mode'] === 'oauth' ? 'oauth' : 'credential_schema',
    configured: source['configured'] === true,
    credentialKeys: toStrings(source['credential_keys']),
    credentialSchema: schema.map(toField).filter((f): f is McpCredentialField => f !== null),
    oauthAuthenticated: source['oauth_authenticated'] === true,
    ...(typeof expires === 'number' ? { oauthExpiresAt: expires } : {}),
  }
}

function toField(value: unknown): McpCredentialField | null {
  const source = asRecord(value)
  const key = source['key']
  if (typeof key !== 'string' || key === '') return null
  // required 는 기본이 true 다 (runtime 기본값과 같게)
  return { key, required: source['required'] !== false }
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
