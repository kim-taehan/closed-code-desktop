// opencode 헤드리스 서버 HTTP 클라이언트.
//
// **경로는 공식 문서(opencode.ai/docs/server)와 다르다.** 실측(1.17.18 `/doc`) 기준:
//
//   문서                                    실제
//   POST /session/:id/message           →  POST /api/session/:id/prompt   (message 는 GET 전용)
//   POST /session/:id/abort             →  POST /api/session/:id/interrupt
//   POST /session/:id/permissions/:pid  →  POST /api/session/:id/permission/:rid/reply
//
// 문서를 믿고 짜면 404 가 난다. 버전을 올릴 때는 `/doc` 을 다시 떠서 대조할 것.

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

export interface OpencodeClientOptions {
  baseUrl: string
  /** OPENCODE_SERVER_PASSWORD 를 켰을 때만 */
  password?: string
  fetchImpl?: typeof fetch
}

/** opencode 가 모델을 가리키는 방식. 프로바이더와 모델 id 가 따로다. */
export interface ModelRef {
  id: string
  providerID: string
}

/** `GET /config/providers` 응답. `default` 는 프로바이더별 기본 모델 id 다. */
export interface ProvidersResponse {
  providers: { id: string; name?: string; models?: Record<string, unknown> }[]
  default?: Record<string, string>
}

export interface CreateSessionInput {
  directory: string
  model?: ModelRef
  agent?: string
}

/** 승인 응답값 (PermissionV2Reply). davis 의 approved/followUp 을 여기로 접는다. */
export type PermissionReply = 'once' | 'always' | 'reject'

/**
 * `POST /mcp` 가 받는 원격 MCP 서버 설정 (opencode 스키마 `McpRemoteConfig`).
 *
 * ⚠️ `type` 은 **`remote`** 다. 공여(develop-desktop)가 claude 에 넘기던 `{type:"http"}` 와
 * 나머지 필드는 같고 이름만 다르다 — 그대로 베끼면 400 이 난다.
 */
export interface McpRemoteConfig {
  type: 'remote'
  url: string
  headers?: Record<string, string>
  enabled?: boolean
  timeout?: number
}

export class OpencodeClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: OpencodeClientOptions) {
    // 끝의 / 를 떼어 둔다 — 붙어 있으면 `//api/...` 가 되어 404 가 난다.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /**
   * SSE 스트림. **`/api/event` 여야 한다 — 레거시 `/event` 가 아니다.**
   *
   * 실측(1.17.18): 같은 시각 두 스트림을 동시에 떠서 비교했다.
   *   `/api/event` — session.next.* 전부 (238줄)
   *   `/event`     — server.connected + heartbeat 뿐 (10줄)
   *
   * `/event` 를 쓰면 핸드셰이크(server.connected)는 통과하는데 채팅 이벤트가 하나도
   * 안 오고, 스트림이 곧 닫혀 "연결은 됐는데 답이 없다" 가 된다. 프롬프트를 `/api` 로
   * 넣으면 이벤트도 `/api` 로 받아야 한다 — 두 API 세대를 섞지 말 것.
   */
  get eventUrl(): string {
    return `${this.baseUrl}/api/event`
  }

  get headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...opencodeAuthHeaders(this.options.password) }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { headers: this.headers })
    if (!response.ok) {
      throw new Error(`opencode ${path} 실패: HTTP ${response.status} ${await response.text()}`)
    }
    return (await response.json()) as T
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(`opencode ${path} 실패: HTTP ${response.status} ${await response.text()}`)
    }
    // 204 등 본문 없는 응답을 JSON.parse 하면 던진다.
    const text = await response.text()
    if (!text) return {} as T
    const parsed = JSON.parse(text) as unknown

    // **`/api/*` 응답은 `{ data: ... }` 로 감싸여 온다** (실측 1.17.18).
    // 접두사 없는 레거시 경로(`/session`)는 감싸지 않아, 문서 예제를 보고 짜면
    // `id` 가 undefined 인 채로 조용히 흘러간다 — 세션이 없는 상태로 채팅까지 가서
    // "핸드셰이크는 됐는데 답이 안 온다" 가 된다. 여기서 한 겹 벗긴다.
    if (parsed !== null && typeof parsed === 'object' && 'data' in parsed) {
      return (parsed as { data: T }).data
    }
    return parsed as T
  }

  /**
   * 세션을 만든다. directory 가 곧 워크스페이스다.
   *
   * **응답의 `model` 을 함께 돌려준다** — 이게 이 세션의 기본 모델이다. 모델 스위처가
   * 오버라이드를 풀 때 되돌아갈 자리라 만들 때 붙잡아 둬야 한다 (`models.ts` 머리말).
   */
  async createSession(input: CreateSessionInput): Promise<{ id: string; model: ModelRef | null }> {
    const session = await this.post<{ id?: string; model?: ModelRef }>('/api/session', {
      location: { directory: input.directory },
      ...(input.model ? { model: input.model } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
    })
    // id 가 없으면 여기서 끊는다. 그냥 흘려보내면 세션 없는 채로 핸드셰이크가 ready 가 되고,
    // 증상은 한참 뒤 "채팅에 답이 안 온다" 로만 나타난다 (실제로 겪은 실패 경로다).
    if (typeof session.id !== 'string' || !session.id) {
      throw new Error(`opencode 세션 생성 응답에 id 가 없습니다: ${JSON.stringify(session).slice(0, 200)}`)
    }
    const model = session.model
    return {
      id: session.id,
      model: model && typeof model.id === 'string' && typeof model.providerID === 'string' ? model : null,
    }
  }

  /**
   * 설정된 프로바이더와 그 모델 목록.
   *
   * ⚠️ **`/api` 가 아니라 `/config/providers` 다** — 그래서 `{data:...}` 래핑도 없다.
   * `/api/config/providers` 는 없다 (실측 1.17.18, `curl /doc`).
   */
  async providers(): Promise<ProvidersResponse> {
    return this.get<ProvidersResponse>('/config/providers')
  }

  /**
   * 서버 설정. 여기서 필요한 것은 기본 모델(`model`) 하나다.
   *
   * ⚠️ **모델을 주지 않고 세션을 만들면 응답에 `model` 이 없다** (실측 1.17.18 — 줘서
   * 만들면 있다). 그 세션의 기본이 무엇인지는 이 설정값으로만 알 수 있고, 모르면
   * 스위처에서 오버라이드를 풀었을 때 되돌아갈 자리가 없다.
   */
  async config(): Promise<{ model?: string }> {
    return this.get<{ model?: string }>('/config')
  }

  /**
   * 이 세션이 쓸 모델을 바꾼다.
   *
   * **세션에 남는다** — davis 는 요청별 오버라이드였고 runtime 이 기억하지 않았다.
   * 그 차이는 어댑터가 흡수한다 (`models.ts` — 오버라이드를 풀면 기본 모델로 되돌린다).
   */
  async setModel(sessionId: string, model: ModelRef): Promise<void> {
    await this.post(`/api/session/${sessionId}/model`, { model })
  }

  /**
   * 프롬프트를 보낸다.
   *
   * 실측: 이 호출은 턴 완료를 기다리지 않고 **접수 즉시 반환**한다
   * (`{ admittedSeq, id, delivery: "steer" }`). 턴의 진행·결과는 전부 SSE 로 온다.
   * 따라서 응답 본문에는 답변이 없다 — 여기서 답을 꺼내려 하지 말 것.
   */
  async prompt(sessionId: string, text: string): Promise<void> {
    await this.post(`/api/session/${sessionId}/prompt`, { prompt: { text } })
  }

  /**
   * 이 세션이 쓸 에이전트를 바꾼다 (davis 권한 모드 대응 — `agents.ts`).
   *
   * ⚠️ **없는 이름도 204 로 받아 그대로 저장한다** (실측). 서버가 검증해 주지 않으므로
   * 부르는 쪽이 아는 이름만 넘겨야 한다.
   */
  async setAgent(sessionId: string, agent: string): Promise<void> {
    await this.post(`/api/session/${sessionId}/agent`, { agent })
  }

  /** 진행 중인 턴을 끊는다 (davis stream_cancel 대응) */
  async interrupt(sessionId: string): Promise<void> {
    await this.post(`/api/session/${sessionId}/interrupt`, {})
  }

  /** 도구 승인 응답. 보내지 않으면 턴이 그 자리에서 멈춘다. */
  async replyPermission(sessionId: string, requestId: string, reply: PermissionReply): Promise<void> {
    await this.post(`/api/session/${sessionId}/permission/${requestId}/reply`, { reply })
  }

  /**
   * MCP 서버를 **런타임에** 등록한다 (데스크톱이 MCP 서버 노릇을 하는 쪽 — `electron/mcp/`).
   *
   * ⚠️ **이 한 건만 `/api` 가 아니다.** `/api/mcp` 는 없다 (1.17.18 `/doc` 162경로 전수 확인).
   * 다른 곳에서 두 API 세대를 섞지 말라고 해 둔 것과 겉으로 충돌해 보이지만, MCP 는
   * `/api` 판이 아예 없어 선택지가 없다. 레거시 표면이라 `{data:...}` 래핑도 없다 —
   * 응답은 `{"<이름>":{"status":"connected"}}` 그대로다 (실측).
   *
   * ⚠️⚠️ **질의 이름이 평문 `directory=` 다.** 옆의 pty 표면은 `location[directory]=` 이고
   * **둘은 서로 바꿔 쓸 수 없는데 잘못 써도 HTTP 200 이 난다** (contract-qa 실측):
   *
   *   POST /mcp?location[directory]=<A>  → 200 `{"...":{"status":"connected"}}`  ← 성공처럼 보인다
   *   그런데 GET /mcp?directory=<A>      → 없음. 서버 cwd 쪽에 등록돼 있다.
   *
   * 증상은 "로그에 connected 가 찍히는데 세션에 도구가 안 뜬다" 뿐이다. 그래서
   * `register.test.ts` 는 응답이 아니라 **요청 URL 문자열 자체**를 단언한다. 같은 이유로
   * `electron/pty/client.ts` 와 URL 조립 헬퍼를 **공유하지 않는다** — 한쪽 규칙이 다른 쪽으로
   * 새면 두 표면이 조용히 같이 틀어진다.
   *
   * `directory` 를 빼면 서버가 `process.cwd()` 로 떨어져 **엉뚱한 프로젝트에 등록된다.**
   * 실측: `GET /mcp?directory=<다른 프로젝트>` 는 `{}` 를 준다 — 등록은 디렉토리별로 갈린다.
   */
  async addMcpServer(
    directory: string,
    name: string,
    config: McpRemoteConfig,
  ): Promise<Record<string, { status?: string; error?: string }>> {
    return this.post(`/mcp?directory=${encodeURIComponent(directory)}`, { name, config })
  }

  /** ask_user 대응. answer 가 null 이면 거절 경로로 보낸다. */
  async replyQuestion(sessionId: string, requestId: string, answer: string | null): Promise<void> {
    const path = `/api/session/${sessionId}/question/${requestId}`
    if (answer === null) return void (await this.post(`${path}/reject`, {}))
    await this.post(`${path}/reply`, { text: answer })
  }
}
