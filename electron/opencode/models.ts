import type { ModelRef, OpencodeClient, ProvidersResponse } from './client'

// 모델 스위처의 번역 (davis `llm_config` ↔ opencode 모델).
//
// davis 는 둘 중 하나였다 (DC-1322, `shared/protocol/llmConfig.ts`):
//   personal — 사용자의 BYOK 엔드포인트. 목록을 **라이브 조회**해야 해서 ack/replyTo 왕복이 있다.
//   project  — 관리자가 정한 `allowed_models`. 그 목록이 곧 선택지고, 비면 스위처가 숨는다.
//
// **opencode 는 project 쪽에 가깝다.** 고를 수 있는 모델은 사용자가 띄운 서버의 설정 파일
// (`~/.config/opencode/opencode.json` 의 provider·model)이 정하고, 데스크탑은 그것을 바꿀 수
// 없다. 그래서 status 한 번으로 목록까지 실어 보낸다 — personal 경로의 두 번째 왕복
// (`llm_config_models` + 10초 타임아웃)을 흉내 낼 이유가 없다.
//
// **모델 이름은 `providerID/modelID` 한 줄로 접는다.** davis 계약이 문자열 하나만 실어
// 나르기 때문이다(`chat_request.data.model`). opencode 는 둘로 갈라 받으므로 보낼 때
// 다시 편다 — 그 왕복이 아래 두 함수다.

/**
 * 세션에 걸린 모델을 추적한다. 어댑터는 디스패치만 하고 모델 판단은 여기 모아 둔다.
 *
 * 들고 있어야 하는 이유가 둘이다:
 *   - **되돌릴 자리** — 오버라이드를 풀면 기본 모델로 가야 한다 (davis 는 요청별이었다)
 *   - **중복 방지** — 같은 모델을 매 턴 POST 하면 서버 로그가 모델 변경으로 뒤덮인다
 */
export class SessionModel {
  /** 세션을 만들 때 정해진 모델. 없으면 서버 설정에서 늦게 채운다. */
  private base: ModelRef | null = null
  private active: ModelRef | null = null
  /**
   * 이 세션의 프로젝트 디렉토리. **설정 조회에 같이 실어야 한다** — 안 실으면 서버 전역
   * 설정이 와서, 프로젝트가 자기 `opencode.json` 에 정한 기본 모델·프로바이더가 무시된다
   * (`client.config`/`client.providers` 주석의 실측). 세션이 서기 전에는 null 이고,
   * 그때는 전역이 맞는 답이다.
   */
  private directory: string | null = null

  constructor(private readonly client: Pick<OpencodeClient, 'config' | 'providers' | 'setModel'>) {}

  /**
   * 세션 생성 응답이 알려준 기본 모델 (모델을 주지 않고 만들면 null 이다)과
   * 그 세션이 선 프로젝트 디렉토리를 함께 받는다.
   */
  adopt(model: ModelRef | null, directory: string | null): void {
    this.base = model
    this.active = model
    this.directory = directory
  }

  /** 요청한 모델(없으면 기본)로 맞춘다. 이미 그 모델이면 아무것도 하지 않는다. */
  async apply(sessionId: string, requested: ModelRef | null): Promise<void> {
    const next = requested ?? (this.base ??= await serverDefaultModel(this.client, this.directory))
    if (next === null) return
    if (this.active && modelName(this.active) === modelName(next)) return
    await this.client.setModel(sessionId, next)
    this.active = next
  }

  /** 스위처에 돌려줄 davis status payload */
  async status(): Promise<Record<string, unknown>> {
    this.base ??= await serverDefaultModel(this.client, this.directory)
    return resolveStatus(this.client, this.active ?? this.base, this.directory)
  }
}

/** `providerID/modelID`. 화면·`/model` 명령이 이 문자열을 그대로 쓴다. */
export function modelName(ref: ModelRef): string {
  return `${ref.providerID}/${ref.id}`
}

/**
 * `providerID/modelID` 를 다시 편다.
 *
 * **첫 `/` 에서만 자른다** — 모델 id 에 `/` 가 들어가는 프로바이더가 있다
 * (`anthropic/claude-...` 를 그대로 모델 id 로 쓰는 게이트웨이 등). 프로바이더 id 에는
 * `/` 가 없으므로 앞쪽 하나만 갈라내는 것이 안전하다. 모양이 아니면 null 이다.
 */
export function toModelRef(name: string): ModelRef | null {
  const slash = name.indexOf('/')
  if (slash <= 0 || slash === name.length - 1) return null
  return { providerID: name.slice(0, slash), id: name.slice(slash + 1) }
}

/** 설정된 모든 모델을 `providerID/modelID` 로 편다. 프로바이더 등록 순서를 지킨다. */
export function listModels(response: ProvidersResponse): string[] {
  const names: string[] = []
  for (const provider of response.providers ?? []) {
    if (typeof provider?.id !== 'string') continue
    for (const id of Object.keys(provider.models ?? {})) names.push(`${provider.id}/${id}`)
  }
  return names
}

/**
 * davis `llm_config_status` 응답 payload.
 *
 * `source: 'project'` 로 답한다 — 목록을 서버가 정하고 데스크탑이 못 바꾼다는 점이 같다.
 * 스위처는 `allowed_models` 가 비면 숨는다 (fail-closed). 그 규칙을 그대로 둔다:
 * 모델이 하나도 없는 opencode 설정이면 고를 것이 없으니 안 보이는 편이 맞다.
 *
 * 필드 이름이 snake_case 인 것은 davis 런타임 계약이다 (`parseLlmStatus` 가 그렇게 읽는다).
 */
export function statusPayload(current: string, models: string[]): Record<string, unknown> {
  return {
    source: 'project',
    model: current,
    provider_type: '',
    base_url: '',
    allowed_models: models,
  }
}

/**
 * 서버 설정이 정한 기본 모델. 세션을 모델 없이 만들었을 때 되돌아갈 자리다 (`client.config`).
 *
 * 못 알아내면 null 이고, 그때 어댑터는 모델을 건드리지 않는다 — 모르는 채로 아무 모델이나
 * 밀면 사용자가 고르지도 않은 모델로 대화가 이어진다.
 *
 * **`directory` 가 곧 "누구의 기본이냐" 다.** 안 넘기면 서버 전역 기본으로 되돌아가,
 * 프로젝트가 정해 둔 모델이 오버라이드를 풀 때마다 조용히 밀려난다.
 */
export async function serverDefaultModel(
  client: Pick<OpencodeClient, 'config'>,
  directory: string | null,
): Promise<ModelRef | null> {
  try {
    const model = (await client.config(directory)).model
    return typeof model === 'string' ? toModelRef(model) : null
  } catch {
    return null
  }
}

/**
 * 스위처에 돌려줄 status 를 만든다 — 목록 조회까지 여기서 끝낸다.
 *
 * **조회에 실패해도 던지지 않는다.** 스위처는 목록이 비면 스스로 숨으므로(fail-closed)
 * 지금 쓰는 모델 하나만 남긴 목록으로 답한다. 여기서 예외를 올리면 모델과 아무 상관 없는
 * 대화 화면에 실패가 뜬다.
 *
 * **목록도 프로젝트별이다** — `directory` 를 안 넘기면 그 프로젝트에만 설정된 프로바이더가
 * 스위처에서 빠진다 (실측: 3개 대 4개).
 */
export async function resolveStatus(
  client: Pick<OpencodeClient, 'providers'>,
  current: ModelRef | null,
  directory: string | null,
): Promise<Record<string, unknown>> {
  const name = current ? modelName(current) : ''
  try {
    return statusPayload(name, listModels(await client.providers(directory)))
  } catch {
    return statusPayload(name, name ? [name] : [])
  }
}
