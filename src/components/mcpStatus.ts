import { OUR_MCP_SERVER } from '../../shared/protocol/mcpConfig'
import type { McpConnectionStatus, McpServerStatus } from '../../shared/protocol/mcpConfig'

// 커넥터 다이얼로그의 **왼쪽 리스트와 오른쪽 상세가 같이 쓰는** 상태 표기.
// 두 곳이 같은 서버를 다른 색·다른 이름으로 그리면 그게 곧 버그로 읽힌다 —
// 상태 하나에 이름·색·갈래가 한 군데서만 나오게 여기에 모았다.

/** 상태 셋 말고도 OAuth 갈래가 둘 더 온다 — 모르는 것을 「실패」로 칠하지 않는다. */
export const LABELS: Record<McpConnectionStatus, string> = {
  connected: '연결됨',
  failed: '실패',
  disabled: '꺼짐',
  needs_auth: '로그인 필요',
  needs_client_registration: '등록 필요',
  unknown: '알 수 없음',
}

export const TONES: Record<McpConnectionStatus, string> = {
  connected: 'ok',
  failed: 'err',
  disabled: 'off',
  needs_auth: 'warn',
  needs_client_registration: 'warn',
  unknown: 'off',
}

/** `error` 를 싣는 갈래 둘 (`MCPStatusFailed`·`MCPStatusNeedsClientRegistration` 만 필수다). */
export function failed(status: McpConnectionStatus): boolean {
  return status === 'failed' || status === 'needs_client_registration'
}

/**
 * 갈래 한 줄.
 *
 * **이름으로 가린다.** 예전에는 `tools.length > 0` 이었다 — 도구를 아는 것이 우리가 띄운
 * 서버뿐이던 시절에는 맞았지만, 지금은 원격 서버 도구도 채운다
 * (`electron/opencode/remoteMcpTools.ts`). 그대로 뒀으면 사내 원격 서버가 도구를 준
 * 순간 「local · 이 앱이 띄움」으로 뒤집혔다 — 갈래도 정체도 둘 다 거짓말이다.
 *
 * 설정에 없는 남의 런타임 등록 서버는 갈래를 알 길이 없다 — 빈 문자열을 주고,
 * 부르는 쪽이 그 칸을 통째로 뺀다 (빈 칸을 그리느니 뺀다).
 */
export function kindOf(server: McpServerStatus): string {
  if (server.serverName === OUR_MCP_SERVER) return 'local · 이 앱이 띄움'
  return server.transport === 'unknown' ? '' : server.transport
}
