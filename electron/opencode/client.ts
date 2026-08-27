// opencode 헤드리스 서버 HTTP 클라이언트.
//
// 버전을 올릴 때는 `/doc` 을 다시 떠서 대조할 것 — 공식 문서(opencode.ai/docs/server)와
// 실제 경로가 다르고, 문서를 믿고 짜면 404 가 난다.
//
// ⚠️ **채팅 계열은 일부러 레거시(`/api` 없는) 세대를 쓴다** (2026-08-14 전환).
// **다섯이 한 세트다** — 프롬프트·중단·이벤트 스트림·승인 응답·질문 응답. 목록과 실측은
// `legacyChat.ts` 머리말이 정본이고(스트림만 아래 `eventUrl`), 왜 레거시인지와 이벤트
// 매핑표는 `legacyEvents.ts` 머리말이다.
//
// 이 머리말에는 예전에 **`POST /session/:id/permissions/:pid` 를 신규로 고쳐 쓰라**는
// 표가 있었다. 지금은 정확히 거꾸로다 — 그 줄을 되살리면 승인이 다시 404 로 죽는다.

import { opencodeAuthHeaders } from './auth'
import { fetchConfig, fetchProviders, type OpencodeConfig, type ProvidersResponse } from './configApi'
import { httpFailure } from './httpError'
import {
  deleteSession,
  listSessions,
  renameSession,
  sessionMessages,
  type OpencodeMessage,
  type OpencodeSession,
} from './historyApi'
import { abortTurn, replyPermissionLegacy, replyQuestionLegacy, sendPrompt } from './legacyChat'
import { addMcpServer, mcpStatus, setMcpEnabled } from './mcpApi'

// 설정 계열(`configApi.ts`)과 이력 계열(`historyApi.ts`)은 파일이 갈렸지만 타입은 여기서
// 계속 내보낸다 — 부르는 쪽(`models.ts` 등)에 "클라이언트가 주는 것" 으로 남는 편이 맞다.
export type { OpencodeConfig, ProvidersResponse } from './configApi'
export type { OpencodeMessage, OpencodeSession } from './historyApi'

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

/**
 * `GET /mcp` 의 항목 (opencode 스키마 `MCPStatus`).
 *
 * status 는 다섯 갈래이고 `error` 는 `failed`·`needs_client_registration` 에만 있다
 * (1.18.18 `/doc` — 갈래 목록의 정본은 `shared/protocol/mcpConfig.ts`).
 */
export interface McpStatusEntry {
  status?: string
  error?: string
}

export class OpencodeClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: OpencodeClientOptions) {
    // 끝의 / 를 떼어 둔다.
    // ⚠️ **"붙어 있으면 `//api/...` 가 되어 404" 는 실측이 아니었다** — 1.17.18 은
    // `//api/health`·`//api/session` 을 **200 으로 받는다** (D2 후속에서 재 봤다).
    // 그래도 떼는 이유: 사용자가 넣는 주소가 제각각이라 **한 모양으로 모으는 것**이고,
    // 앞에 프록시가 붙었을 때 이중 슬래시가 어떻게 다뤄지는지는 **재 본 적이 없다.**
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /**
   * SSE 스트림. **`/event` 여야 한다 — `/api/event` 가 아니다.**
   *
   * ⚠️ **이 주석은 한 번 뒤집혔다. 예전 판정("`/api/event` 여야 한다")도 실측이었다** —
   * 다만 조건부였다. 스트림의 정답은 **프롬프트를 어느 세대로 넣었는가**에 딸린 값이지
   * 스트림 자체의 성질이 아니다. 두 번 다 같은 시각에 두 스트림을 동시에 떠서 쟀다:
   *
   *   프롬프트 `/api/…/prompt`        → `/api/event` 238줄 · `/event` 10줄 (1.17.18)
   *   프롬프트 `/session/…/prompt_async` → `/event` 44건 · `/api/event` 6건 (1.18.18)
   *
   * **두 API 세대를 섞지 말 것** — 이 규칙만 그대로다. 바뀐 것은 우리가 선 세대다.
   *
   * `?directory=` 는 붙이지 않는다. 스트림은 세션보다 먼저 열려 그 시점에 디렉토리를
   * 모르고, `/event` 는 **서버 전역**이라 붙일 데도 없다 — 남의 세션을 거르는 것은
   * `transport.ts` 의 sessionID 필터 하나다 (`multiSession.test.ts`).
   */
  get eventUrl(): string {
    return `${this.baseUrl}/event`
  }

  get headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...opencodeAuthHeaders(this.options.password) }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { headers: this.headers })
    if (!response.ok) {
      throw new Error(await httpFailure(path, response))
    }
    return (await response.json()) as T
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  /**
   * POST 와 같은 규칙에 메서드만 갈아 끼운다 — 이력 삭제·제목 변경이 **DELETE·PATCH 로만**
   * 있어서 열었다 (`historyApi.ts` 머리말: 신규 세대에는 그 둘이 아예 없다).
   * 본문이 없으면 싣지 않는다 — DELETE 에 빈 본문을 실으면 거절하는 서버가 있다.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      throw new Error(await httpFailure(path, response))
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

  /** 설정된 프로바이더와 그 모델 목록 (실측과 `?directory=` 함정은 `configApi.ts`). */
  async providers(directory: string | null): Promise<ProvidersResponse> {
    return fetchProviders((path) => this.get(path), directory)
  }

  /** 서버 설정 — 여기서 필요한 것은 기본 모델 하나다 (실측은 `configApi.ts`). */
  async config(directory: string | null): Promise<OpencodeConfig> {
    return fetchConfig((path) => this.get(path), directory)
  }

  /**
   * 이 프로젝트의 대화 목록 (이력 다이얼로그 — 번역은 `chatHistory.ts`).
   *
   * ⚠️ **`directory` 를 빼면 서버가 아는 세션이 전부 온다** — 다른 프로젝트 것까지
   * (실측·사유는 `historyApi.ts` 머리말).
   *
   * `search` 는 **서버가 제목으로 거른다** (실측한 성질은 `historyApi.ts` — 본문은 안 뒤진다).
   */
  async listSessions(directory: string | null, search?: string): Promise<OpencodeSession[]> {
    return listSessions((path) => this.get(path), directory, search)
  }

  /** 대화 한 건의 전체 내용. **레거시에만 있다** — 신규는 이벤트 로그를 준다 (`historyApi.ts`). */
  async sessionMessages(sessionId: string): Promise<OpencodeMessage[]> {
    return sessionMessages((path) => this.get(path), sessionId)
  }

  /** 대화를 지운다. 신규 세대에는 DELETE 자체가 없다 (`historyApi.ts`). */
  async deleteSession(sessionId: string, directory: string | null): Promise<void> {
    await deleteSession((method, path, body) => this.request(method, path, body), sessionId, directory)
  }

  /** 대화 제목을 바꾼다 (`/rename`). 신규 세대에는 PATCH 가 없다 (`historyApi.ts`). */
  async renameSession(sessionId: string, directory: string | null, title: string): Promise<void> {
    await renameSession((method, path, body) => this.request(method, path, body), sessionId, directory, title)
  }

  /**
   * MCP 서버들의 연결 상태 (커넥터 다이얼로그 — 실측과 함정은 `mcpApi.ts`).
   */
  async mcpStatus(directory: string | null): Promise<Record<string, McpStatusEntry>> {
    return mcpStatus((path) => this.get(path), directory)
  }

  /** MCP 서버를 켜거나 끈다. **응답 불린을 믿지 말 것** — 사유는 `mcpApi.ts`. */
  async setMcpEnabled(directory: string | null, name: string, enabled: boolean): Promise<void> {
    await setMcpEnabled((path, body) => this.post(path, body), directory, name, enabled)
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

  /** 프롬프트를 보낸다 (레거시 세대 — 실측과 본문 규칙은 `legacyChat.ts`). */
  async prompt(sessionId: string, text: string): Promise<void> {
    await sendPrompt((path, body) => this.post(path, body), sessionId, text)
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

  /** 진행 중인 턴을 끊는다 (레거시 세대 — 실측은 `legacyChat.ts`). */
  async interrupt(sessionId: string): Promise<void> {
    await abortTurn((path, body) => this.post(path, body), sessionId)
  }

  /** 도구 승인 응답 (레거시 세대 — 실측은 `legacyChat.ts`). 안 보내면 턴이 그 자리에서 멈춘다. */
  async replyPermission(sessionId: string, requestId: string, reply: PermissionReply): Promise<void> {
    await replyPermissionLegacy((path, body) => this.post(path, body), sessionId, requestId, reply)
  }

  /**
   * MCP 서버를 **런타임에** 등록한다 (데스크톱이 MCP 서버 노릇을 하는 쪽 — `electron/mcp/`).
   *
   * 질의 이름·응답 모양의 실측과 그 함정은 `mcpApi.ts` 머리말이 정본이다.
   */
  async addMcpServer(
    directory: string,
    name: string,
    config: McpRemoteConfig,
  ): Promise<Record<string, McpStatusEntry>> {
    return addMcpServer((path, body) => this.post(path, body), directory, name, config)
  }

  /**
   * ask_user 대응 (레거시 세대 — 실측은 `legacyChat.ts`).
   *
   * `sessionId` 를 받지만 안 쓴다 — 레거시 질문 표면은 요청 id 하나로 찾는다.
   * 부르는 쪽(`replies.ts`)의 모양을 승인과 맞춰 두려고 인자는 남긴다.
   */
  async replyQuestion(_sessionId: string, requestId: string, answer: string | null): Promise<void> {
    await replyQuestionLegacy((path, body) => this.post(path, body), requestId, answer)
  }
}
