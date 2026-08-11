import { OpencodeClient } from '../opencode/client'
import { SERVER_NAME } from './rpc'
import type { McpAddress } from './server'

// **주입 대체 지점.**
//
// 공여(develop-desktop)는 CLI 를 띄우면서 `--mcp-config '<JSON>'` 인자로 자기 주소를 줬다
// (`electron/pty/args.ts:33`). 이 앱은 CLI 를 띄우지 않는다 — opencode 서버는 사용자가
// 띄운 것이고 우리는 붙을 뿐이다. 그래서 그 자리를 **HTTP 런타임 등록**이 대신한다.
//
// 사용자의 `~/.config/opencode/opencode.json` 은 **건드리지 않는다.** 실측: `POST /mcp`
// 뒤에도 그 파일에 `mcp` 키가 생기지 않는다. 등록이 opencode instance 수명이라 앱을 끄면
// 죽은 항목이 사용자 설정에 남지 않는 것도 이 설계의 장점이다 — 대신 **재연결마다 다시
// 등록해야 한다** (`POST /instance/dispose` 뒤 `GET /mcp` 는 `{}` 다).

/** 신원을 두 겹으로 싣는다 — 왜 한 겹으로 줄이면 안 되는지는 `registrationOf` 주석. */
export interface McpRegistration {
  /** 붙어 있는 opencode 서버 주소 */
  opencodeUrl: string
  /** 이 등록이 사는 프로젝트의 절대경로. opencode 쪽 격리의 근거다 */
  directory: string
  /** 우리 URL 경로에 실을 프로젝트 신원 */
  projectId: string
  /** 우리 MCP 서버가 듣는 포트와 이번 실행의 토큰 */
  address: McpAddress
  password?: string
  fetchImpl?: typeof fetch
}

/**
 * 우리 서버의 주소를 만든다.
 *
 * **신원이 두 겹이다.**
 *   1. opencode 쪽 `?directory=` — A 에 등록한 도구가 B 세션의 도구 목록에 들어가는 것을 막는다
 *   2. 우리 쪽 URL 경로 `/mcp/<projectId>` — 요청이 도착했을 때 **앱이 스스로** 주인을 안다
 *
 * 한 겹으로 줄이지 않는다. 1번만 두면 앱이 opencode 의 격리를 *믿는* 것이고, 요청만 보고는
 * 어느 프로젝트 것인지 판단할 근거가 없다. 2번만 두면 토큰·URL 이 새는 순간 막을 것이 없다.
 */
export function mcpUrlOf(address: McpAddress, projectId: string): string {
  return `http://127.0.0.1:${address.port}/mcp/${encodeURIComponent(projectId)}`
}

/** 등록 결과. **실패 사유는 `error` 에만 있다** — 버리면 원인을 알 길이 없다. */
export interface McpRegistrationResult {
  status: string
  error?: string
}

/**
 * opencode 에 우리 서버를 등록한다.
 *
 * 같은 이름으로 다시 불러도 새로 붙을 뿐이라 멱등에 가깝다 (실측으로 두 번 등록해 확인).
 *
 * ⚠️ **응답은 등록한 것 하나가 아니라 서버가 아는 MCP 전체 맵이다** (실측 — 사용자가 따로
 * 등록해 둔 서버가 있으면 그것도 함께 온다). 반드시 **이름으로 인덱싱**한다.
 * `Object.values(res)[0]` 로 하면 남의 서버 상태를 우리 것으로 읽는다.
 *
 * 못 붙었을 때의 상태는 (실측, contract-qa 재계측으로 정정):
 *   · 주소에 안 닿음 + `enabled:true` → **`failed`** + `error: "SSE error: Unable to connect…"`
 *   · `enabled:false` 로 등록          → `disabled`
 * 우리는 늘 `enabled:true` 를 보내므로 실제로 보는 것은 `failed` 다. `disabled` 는 사용자가
 * 자기 설정으로 꺼 둔 서버에서나 나온다.
 */
export async function registerMcpServer(
  registration: McpRegistration,
): Promise<McpRegistrationResult> {
  const client = new OpencodeClient({
    baseUrl: registration.opencodeUrl,
    ...(registration.password !== undefined ? { password: registration.password } : {}),
    ...(registration.fetchImpl !== undefined ? { fetchImpl: registration.fetchImpl } : {}),
  })

  const status = await client.addMcpServer(registration.directory, SERVER_NAME, {
    type: 'remote',
    url: mcpUrlOf(registration.address, registration.projectId),
    // 토큰은 실행마다 새로 만든다 — 앱을 껐다 켜면 옛 등록은 401 로 죽는다
    headers: { Authorization: `Bearer ${registration.address.token}` },
    enabled: true,
  })

  // 이름으로 인덱싱한다 (머리말) — 우리 이름이 맵에 없으면 등록 자체가 안 먹은 것이다
  const ours = status[SERVER_NAME]
  return {
    status: ours?.status ?? 'unknown',
    ...(ours?.error !== undefined ? { error: ours.error } : {}),
  }
}
