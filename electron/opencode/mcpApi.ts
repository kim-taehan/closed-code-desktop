import type { McpRemoteConfig, McpStatusEntry } from './client'

// opencode 의 MCP 표면 셋 (`GET /mcp` · `POST /mcp` · `POST /mcp/:name/{connect,disconnect}`).
//
// `client.ts` 에서 갈라냈다 (300줄 상한). 갈라 두니 그 파일의 규칙 하나가 저절로 지켜진다 —
// **`withDirectory` 헬퍼를 이쪽으로 넓히지 말 것** (`client.ts` 의 그 주석). MCP 표면은
// 질의 이름을 여기서 직접 조립한다. 헬퍼를 나눠 쓰면 한쪽 규칙이 다른 표면으로 새고,
// 그 어긋남은 **HTTP 200 뒤에 숨는다**.
//
// ⚠️⚠️ **질의 이름이 평문 `directory=` 다.** 옆의 pty 표면은 `location[directory]=` 이고
// **둘은 서로 바꿔 쓸 수 없는데 잘못 써도 HTTP 200 이 난다** (contract-qa 실측):
//
//   POST /mcp?location[directory]=<A>  → 200 `{"...":{"status":"connected"}}`  ← 성공처럼 보인다
//   그런데 GET /mcp?directory=<A>      → 없음. 서버 cwd 쪽에 등록돼 있다.
//
// 증상은 "로그에 connected 가 찍히는데 세션에 도구가 안 뜬다" 뿐이다. 그래서
// `register.test.ts` 는 응답이 아니라 **요청 URL 문자열 자체**를 단언한다.
//
// `directory` 를 빼면 서버가 `process.cwd()` 로 떨어져 **엉뚱한 프로젝트를 본다.**
// 실측: `GET /mcp?directory=<다른 프로젝트>` 는 `{}` 를 준다 — 등록은 디렉토리별로 갈린다.
//
// 이 표면은 **`/api` 판이 아예 없어서 레거시다** — `/api/mcp` 는 없다 (1.17.18 `/doc`
// 162경로 전수 확인). 채팅 계열이 레거시인 것은 골라서 그런 것이고(`client.ts` 머리말)
// 여기는 선택지가 없다는 점이 다르다. 레거시라 `{data:…}` 래핑도 없다 —
// 응답은 `{"<이름>":{"status":"connected"}}` 그대로다 (실측).

/** `client.ts` 의 private `get`/`post` 를 빌려 온다 (`legacyChat.ts` 와 같은 방식). */
export type Getter = <T>(path: string) => Promise<T>
export type Poster = <T>(path: string, body: unknown) => Promise<T>

function mcpPath(suffix: string, directory: string | null): string {
  const query = directory ? `?directory=${encodeURIComponent(directory)}` : ''
  return `/mcp${suffix}${query}`
}

/**
 * MCP 서버들의 연결 상태 (커넥터 다이얼로그 — 번역은 `mcpConfig.ts`).
 *
 * ⚠️ **죽은 원격 서버가 있으면 수십 초 걸린다** — opencode 가 붙어 보고 나서 답한다.
 * 짧은 타임아웃으로 재면 "표면이 없다" 처럼 보인다 (실측 중 실제로 겪었다).
 */
export async function mcpStatus(
  get: Getter,
  directory: string | null,
): Promise<Record<string, McpStatusEntry>> {
  return get<Record<string, McpStatusEntry>>(mcpPath('', directory))
}

/**
 * MCP 서버를 켜거나 끈다 — 다이얼로그의 「다시 연결」·「켜기」가 여기로 온다.
 *
 * ⚠️ **응답 불린을 믿지 말 것.** 붙는 데 실패해도 `true` 를 준다 (실측: 죽은 주소에
 * connect → `200 true`, 직후 `GET /mcp` 는 여전히 `failed`). `true` 는 "연결됐다" 가 아니라
 * "시도를 접수했다" 다 — 그래서 부르는 쪽(`mcpConfig.ts`)은 이 값을 버리고 상태를 다시 읽는다.
 * 반환형을 void 로 둔 것이 그 뜻이다.
 *
 * `connect` 는 꺼져 있던(`disabled`) 서버도 켠다 — 실측으로 `disabled` → `failed` 로 넘어갔다
 * (= 켜고 붙어 보다 실패). 그래서 「켜기」와 「다시 연결」이 같은 엔드포인트 하나다.
 * `disconnect` 는 `disabled` 로 되돌린다. 없는 이름은 404 다.
 */
export async function setMcpEnabled(
  post: Poster,
  directory: string | null,
  name: string,
  enabled: boolean,
): Promise<void> {
  const action = enabled ? 'connect' : 'disconnect'
  await post(mcpPath(`/${encodeURIComponent(name)}/${action}`, directory), {})
}

/**
 * MCP 서버를 **런타임에** 등록한다 (데스크톱이 MCP 서버 노릇을 하는 쪽 — `electron/mcp/`).
 *
 * ⚠️ **응답은 등록한 것 하나가 아니라 서버가 아는 MCP 전체 맵이다** (실측 — 사용자가 따로
 * 등록해 둔 서버가 있으면 그것도 함께 온다). 반드시 **이름으로 인덱싱**한다.
 * `Object.values(res)[0]` 로 하면 남의 서버 상태를 우리 것으로 읽는다 (`register.ts`).
 */
export async function addMcpServer(
  post: Poster,
  directory: string,
  name: string,
  config: McpRemoteConfig,
): Promise<Record<string, McpStatusEntry>> {
  return post(mcpPath('', directory), { name, config })
}
