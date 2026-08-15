// opencode 서버 인증 헤더.
//
// `client.ts` 에서 갈라냈다 (300줄 상한). 쓰는 곳이 둘이라 원래도 공유물이었다 —
// HTTP 클라이언트(`client.ts`)와 pty WebSocket(`pty/client.ts`).

/**
 * `OPENCODE_SERVER_PASSWORD` 를 건 서버에 붙을 때의 인증 헤더.
 *
 * ⚠️ **Bearer 가 아니라 HTTP Basic 이고, 사용자명이 `opencode` 로 고정이다** (1.17.18 실측).
 * 네 가지를 다 넣어 봤고 통과한 것은 이것 하나뿐이었다:
 *
 *   Authorization: Bearer <pw>              → 401
 *   x-opencode-password: <pw>               → 401
 *   Authorization: Basic <"":pw>            → 401   (사용자명이 비면 안 된다)
 *   Authorization: Basic <"opencode":pw>    → 200
 *
 * **HTTP 와 WebSocket 이 같은 헤더를 쓴다** — pty 드로어의 WS(`electron/pty/socket.ts`)도
 * 이걸 그대로 실어야 붙는다 (비밀번호 건 서버에서 헤더 없이 열면 HTTP 401 로 끊긴다).
 * `POST /api/pty/{id}/connect-token` 은 비밀번호를 걸든 안 걸든 403 을 주므로 안 쓴다.
 */
export function opencodeAuthHeaders(password?: string): Record<string, string> {
  if (!password) return {}
  return { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` }
}
