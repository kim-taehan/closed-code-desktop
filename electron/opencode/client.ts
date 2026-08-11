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

export interface OpencodeClientOptions {
  baseUrl: string
  /** OPENCODE_SERVER_PASSWORD 를 켰을 때만 */
  password?: string
  fetchImpl?: typeof fetch
}

export interface CreateSessionInput {
  directory: string
  model?: { id: string; providerID: string }
  agent?: string
}

/** 승인 응답값 (PermissionV2Reply). davis 의 approved/followUp 을 여기로 접는다. */
export type PermissionReply = 'once' | 'always' | 'reject'

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
    return {
      'Content-Type': 'application/json',
      ...(this.options.password ? { Authorization: `Bearer ${this.options.password}` } : {}),
    }
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

  /** 세션을 만든다. directory 가 곧 워크스페이스다. */
  async createSession(input: CreateSessionInput): Promise<{ id: string }> {
    const session = await this.post<{ id?: string }>('/api/session', {
      location: { directory: input.directory },
      ...(input.model ? { model: input.model } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
    })
    // id 가 없으면 여기서 끊는다. 그냥 흘려보내면 세션 없는 채로 핸드셰이크가 ready 가 되고,
    // 증상은 한참 뒤 "채팅에 답이 안 온다" 로만 나타난다 (실제로 겪은 실패 경로다).
    if (typeof session.id !== 'string' || !session.id) {
      throw new Error(`opencode 세션 생성 응답에 id 가 없습니다: ${JSON.stringify(session).slice(0, 200)}`)
    }
    return { id: session.id }
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

  /** 진행 중인 턴을 끊는다 (davis stream_cancel 대응) */
  async interrupt(sessionId: string): Promise<void> {
    await this.post(`/api/session/${sessionId}/interrupt`, {})
  }

  /** 도구 승인 응답. 보내지 않으면 턴이 그 자리에서 멈춘다. */
  async replyPermission(sessionId: string, requestId: string, reply: PermissionReply): Promise<void> {
    await this.post(`/api/session/${sessionId}/permission/${requestId}/reply`, { reply })
  }

  /** ask_user 대응. answer 가 null 이면 거절 경로로 보낸다. */
  async replyQuestion(sessionId: string, requestId: string, answer: string | null): Promise<void> {
    const path = `/api/session/${sessionId}/question/${requestId}`
    if (answer === null) return void (await this.post(`${path}/reject`, {}))
    await this.post(`${path}/reply`, { text: answer })
  }
}
