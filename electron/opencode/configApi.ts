// 설정 계열 질의 둘 (`GET /config` · `GET /config/providers`).
//
// `client.ts` 에서 갈라냈다 (300줄 상한 — `mcpApi.ts`·`legacyChat.ts` 와 같은 사유).
// 대화 이력 표면(`historyApi.ts`)이 들어오면서 그 파일에 자리가 없었다.
//
// **`withDirectory` 가 여기로 함께 왔다.** 이 헬퍼는 원래 `client.ts` 에 있었고 그 주석이
// 「다른 표면으로 넓히지 말 것」이었는데, 갈라 두니 그 규칙이 파일 경계로 지켜진다 —
// 질의 이름은 표면마다 갈리고(MCP 는 `mcpApi.ts` 에서, pty 는 `location[directory]=`),
// 한쪽 규칙이 헬퍼를 타고 넘어가면 두 표면이 조용히 같이 틀어진다.

/** `client.ts` 의 private `get` 을 빌려 온다 (`mcpApi.ts` 와 같은 방식). */
export type Getter = <T>(path: string) => Promise<T>

/** `GET /config/providers` 응답. `default` 는 프로바이더별 기본 모델 id 다. */
export interface ProvidersResponse {
  providers: { id: string; name?: string; models?: Record<string, unknown> }[]
  default?: Record<string, string>
}

/**
 * `GET /config` 중 우리가 읽는 것.
 *
 * **`mcp` 절이 여기에만 있다** — `GET /mcp` 는 상태만 주고 주소도 local/remote 도 안 준다
 * (실측). 다이얼로그가 "remote · http://…" 를 그리려면 두 표면을 합쳐야 한다.
 */
export interface OpencodeConfig {
  model?: string
  mcp?: Record<string, { type?: string; url?: string; command?: unknown; enabled?: boolean }>
}

/**
 * 설정 계열 질의에 프로젝트 신원을 싣는다.
 *
 * 디렉토리를 모를 때(세션 전)는 붙이지 않는다 — 그때는 서버 전역 설정이 답이다.
 */
function withDirectory(path: string, directory: string | null): string {
  if (directory === null || directory === '') return path
  return `${path}?directory=${encodeURIComponent(directory)}`
}

/**
 * 설정된 프로바이더와 그 모델 목록.
 *
 * ⚠️ **`/api` 가 아니라 `/config/providers` 다** — 그래서 `{data:...}` 래핑도 없다.
 * `/api/config/providers` 는 없다 (실측 1.17.18, `curl /doc`).
 *
 * **없는데 404 가 아니다.** 그 주소는 **200 에 웹 UI HTML** 을 준다 (SPA 폴백).
 * `response.ok` 가 참이라 거기서 안 끊기고 JSON 파싱에서야 터진다 — 상태 코드로는
 * 못 가린다. docs/DEVELOPMENT.md 실측 함정 11.
 *
 * ⚠️ **`?directory=` 를 실어야 그 프로젝트의 `opencode.json` 을 읽는다** (2026-08-14 실측).
 * 서버 하나로 프로젝트가 여럿일 때 답이 갈린다 — 같은 서버에서 없이 부르면 프로바이더 3개,
 * `directory=projX` 로 부르면 4개(그 프로젝트에만 있는 것 하나가 더 온다).
 * **틀려도 200 이다** — 질의 이름을 못 알아들으면 그냥 무시하고 전역 설정을 준다.
 */
export async function fetchProviders(get: Getter, directory: string | null): Promise<ProvidersResponse> {
  return get<ProvidersResponse>(withDirectory('/config/providers', directory))
}

/**
 * 서버 설정. 여기서 필요한 것은 기본 모델(`model`) 하나다.
 *
 * ⚠️ **모델을 주지 않고 세션을 만들면 응답에 `model` 이 없다** (실측 1.17.18 — 줘서
 * 만들면 있다). 그 세션의 기본이 무엇인지는 이 설정값으로만 알 수 있고, 모르면
 * 스위처에서 오버라이드를 풀었을 때 되돌아갈 자리가 없다.
 *
 * ⚠️ **여기도 `?directory=` 가 필요하다** (2026-08-14 실측). 프로젝트가 자기
 * `opencode.json` 에 `"model"` 을 정해 두면 없이 부를 때와 값이 다르다 — 전역
 * `davis-litellm/glm-5.2` 대 프로젝트 `projonly/only-here`. 안 실으면 오버라이드를
 * 풀었을 때 **그 프로젝트가 정한 기본이 아닌 전역 모델로** 되돌아간다.
 */
export async function fetchConfig(get: Getter, directory: string | null): Promise<OpencodeConfig> {
  return get<OpencodeConfig>(withDirectory('/config', directory))
}
