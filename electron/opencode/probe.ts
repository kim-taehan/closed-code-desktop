// 연결 진단용 프로브. Doctor 의 앞 두 단계가 이걸 쓴다.
//
// davis 시절엔 **Admin 서버 ping → 라이선스 검증** 이었다. opencode 에는 둘 다 없다 —
// 중앙 서버도 라이선스도 없고, 키·사용량·모델 접근 제어는 LLM 프록시(LiteLLM)가 맡는다.
// 그래서 이 앱이 확인할 수 있는(그리고 확인해야 하는) 것은 두 가지뿐이다:
//
//   1. opencode 서버가 떠 있나        → GET /api/health
//   2. 쓸 모델이 붙어 있나            → GET /config/providers
//
// 2번이 중요한 이유: 서버는 떠 있는데 프로바이더 설정(`~/.config/opencode/opencode.json`)이
// 비었거나 프록시 키가 죽으면, 증상이 "보내도 답이 없다" 로만 나타난다. 미리 갈라 준다.

export interface ProbeResult {
  ok: boolean
  detail: string
}

const TIMEOUT_MS = 5_000

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as unknown
  } finally {
    clearTimeout(timer)
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // abort 는 "느리다" 가 아니라 "안 떠 있다" 일 때가 대부분이다 — 그렇게 읽히게 쓴다
    if (error.name === 'AbortError') return `응답이 없습니다 (${TIMEOUT_MS}ms 초과)`
    return error.message
  }
  return String(error)
}

/** opencode 서버가 떠 있나 */
export async function pingOpencode(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (trimmed === '') return { ok: false, detail: 'opencode 서버 주소가 비어 있습니다' }
  try {
    const body = (await getJson(`${trimmed}/api/health`, fetchImpl)) as { healthy?: boolean }
    if (body?.healthy === true) return { ok: true, detail: `${trimmed} 응답` }
    return { ok: false, detail: 'health 응답이 healthy 가 아닙니다' }
  } catch (error) {
    return { ok: false, detail: `${describe(error)} — \`opencode serve\` 가 떠 있는지 확인하세요` }
  }
}

interface ConfiguredProvider {
  id?: string
  models?: Record<string, unknown>
}

/**
 * 쓸 모델이 있나.
 *
 * opencode 자체 무료 프로바이더(`opencode`)만 있는 상태도 "설정 안 됨"으로 본다 —
 * 사내에서는 프록시 프로바이더를 쓰기로 했고, 그게 없으면 엉뚱한 모델로 조용히 돌아간다.
 */
export async function checkModels(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (trimmed === '') return { ok: false, detail: 'opencode 서버 주소가 비어 있습니다' }
  try {
    const body = (await getJson(`${trimmed}/config/providers`, fetchImpl)) as
      | ConfiguredProvider[]
      | { data?: ConfiguredProvider[]; providers?: ConfiguredProvider[] }
    const providers = Array.isArray(body) ? body : (body.providers ?? body.data ?? [])
    const named = providers
      .map((provider) => ({ id: provider.id ?? '?', count: Object.keys(provider.models ?? {}).length }))
      .filter((provider) => provider.count > 0)

    if (named.length === 0) {
      return { ok: false, detail: '설정된 모델이 없습니다 — ~/.config/opencode/opencode.json 을 확인하세요' }
    }
    return {
      ok: true,
      detail: named.map((provider) => `${provider.id} (${provider.count})`).join(', '),
    }
  } catch (error) {
    return { ok: false, detail: describe(error) }
  }
}
