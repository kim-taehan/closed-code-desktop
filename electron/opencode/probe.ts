// 연결 진단용 프로브. Doctor 의 앞 두 단계가 이걸 쓴다.
//
// davis 시절엔 **Admin 서버 ping → 라이선스 검증** 이었다. opencode 에는 둘 다 없다 —
// 중앙 서버도 라이선스도 없고, 키·사용량·모델 접근 제어는 LLM 프록시(LiteLLM)가 맡는다.
// 그래서 이 앱이 확인할 수 있는(그리고 확인해야 하는) 것은 두 가지뿐이다:
//
//   1. opencode 서버가 떠 있나        → GET /global/health   (+ 버전 하한선 대조)
//   2. 쓸 모델이 붙어 있나            → GET /config/providers (+ 프로바이더 baseURL 생사)
//
// 2번이 중요한 이유: 서버는 떠 있는데 프로바이더 설정(`~/.config/opencode/opencode.json`)이
// 비었거나 프록시 키가 죽으면, 증상이 "보내도 답이 없다" 로만 나타난다. 미리 갈라 준다.
//
// ⚠️ **1번이 `/api/health` 가 아니다.** `/api/health` 도 실재하고 `{"healthy":true}` 를
// 정상으로 준다 — 바꾼 이유는 고장이 아니라 **`/global/health` 만 릴리스 버전을 주기 때문**이다
// (`{"healthy":true,"version":"1.17.18"}`). `/doc` 의 `info.version` 을 릴리스 버전으로 읽으면
// 안 된다 — 그것은 OpenAPI 스펙 버전이고 1.17.18·1.18.16 **두 버전 모두 `"1.0.0"`** 이다.

import { MIN_OPENCODE_VERSION, meetsMinimum } from '../../shared/opencode/version'

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

/** opencode 서버가 떠 있나 — 그리고 어댑터가 맞춰진 버전인가 */
export async function pingOpencode(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (trimmed === '') return { ok: false, detail: 'opencode 서버 주소가 비어 있습니다' }
  try {
    const body = (await getJson(`${trimmed}/global/health`, fetchImpl)) as {
      healthy?: boolean
      version?: string
    }
    if (body?.healthy !== true) return { ok: false, detail: 'health 응답이 healthy 가 아닙니다' }
    return versionVerdict(trimmed, body.version)
  } catch (error) {
    return { ok: false, detail: `${describe(error)} — \`opencode serve\` 가 떠 있는지 확인하세요` }
  }
}

/**
 * 하한선 대조. **상한은 없다** — 근거는 `MIN_OPENCODE_VERSION` 주석에 있다.
 *
 * 버전 필드가 없는 응답은 **막지 않는다.** 상한을 두지 않는 것과 같은 이유다 —
 * 우리가 아는 것은 "1.17.18 미만은 위험하다" 뿐이고, 버전을 안 주는 서버는
 * 재 본 적이 없는 경우다. 모르는 것을 실패로 적으면 진단이 거짓말을 한다.
 */
function versionVerdict(trimmed: string, version?: string): ProbeResult {
  if (typeof version !== 'string' || version.trim() === '') {
    return { ok: true, detail: `${trimmed} 응답 (버전 미상)` }
  }
  if (!meetsMinimum(version)) {
    return {
      ok: false,
      detail: `opencode ${version} — 확인된 최저 버전 ${MIN_OPENCODE_VERSION} 보다 낮습니다. 서버를 올리세요`,
    }
  }
  // 진단 패널은 사람이 캡처해서 묻는 화면이다. 버전이 찍혀 있으면 되묻지 않아도 된다.
  return { ok: true, detail: `${trimmed} 응답 (opencode ${version})` }
}

interface ConfiguredProvider {
  id?: string
  models?: Record<string, unknown>
  /**
   * ⚠️ **`apiKey` 가 이 안에 같이 실려 온다** (실측: `ollama-local` →
   * `{"baseURL":"http://127.0.0.1:11434/v1","apiKey":"ollama"}`).
   * 여기서 꺼내는 것은 `baseURL` 뿐이고, 화면에 나가는 것은 그 **host 만**이다.
   */
  options?: { baseURL?: string }
}

/**
 * 쓸 모델이 있나. **두 겹이다.**
 *
 *   1. 프로바이더·모델이 잡혀 있나  (`GET /config/providers`)
 *   2. 그 프로바이더 주소가 살아 있나 (`options.baseURL` ping)
 *
 * opencode 자체 무료 프로바이더(`opencode`)만 있는 상태도 "설정 안 됨"으로 본다 —
 * 사내에서는 프록시 프로바이더를 쓰기로 했고, 그게 없으면 엉뚱한 모델로 조용히 돌아간다.
 *
 * **2번이 없으면 거짓 초록이 난다.** `GET /config/providers` 응답에는 생사를 나타내는 필드가
 * 하나도 없다 (`id·name·source·env·options·models` 전수 확인) — 순수 설정 목록이다.
 * 그래서 **설정만 되고 죽은 프로바이더가 초록으로 지나갔다.** 실제로 밟았다:
 * ollama 데몬이 안 떠 있었는데 진단은 "모든 계층 정상" 이었고 증상은 "턴이 답을 못 받는다" 였다.
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
      .map((provider) => ({
        id: provider.id ?? '?',
        count: Object.keys(provider.models ?? {}).length,
        baseUrl: provider.options?.baseURL,
      }))
      .filter((provider) => provider.count > 0)

    if (named.length === 0) {
      return { ok: false, detail: '설정된 모델이 없습니다 — ~/.config/opencode/opencode.json 을 확인하세요' }
    }

    const dead = await deadProviders(named, fetchImpl)
    if (dead.length > 0) {
      return { ok: false, detail: `${dead.join(', ')} 에 닿지 못했습니다 — 그 프로바이더가 떠 있는지 확인하세요` }
    }
    return {
      ok: true,
      detail: named.map((provider) => `${provider.id} (${provider.count})`).join(', '),
    }
  } catch (error) {
    return { ok: false, detail: describe(error) }
  }
}

interface CountedProvider {
  id: string
  count: number
  baseUrl?: string
}

/**
 * `baseURL` 이 있는 프로바이더 중 응답이 없는 것들. **전부**를 본다.
 *
 * 「고른 프로바이더 하나만」이 아닌 이유 둘:
 *
 *   - `checkModels` 는 **무엇을 골랐는지 모른다.** 넘어오는 것은 opencode 주소 하나뿐이고
 *     (`projectBridge.ts` → `preload.ts` → `connectionProbe.ts`), 선택을 실어 나르려면
 *     IPC 계약을 넓혀야 한다. 그럴 값이 없다 — 설정해 둔 로컬 프로바이더가 죽은 것은
 *     지금 안 쓰더라도 사람이 알아야 하는 상태다.
 *   - **「하나만 살아 있으면 통과」로 하면 원래 잡으려던 실패를 놓친다.** 실측 설정에는
 *     `opencode`(원격, baseURL 없음)와 `ollama-local`(로컬)이 같이 있고, 원격 쪽은 항상
 *     건너뛰어 초록이다. ollama 가 죽어도 그 규칙이면 초록이 된다.
 *
 * `baseURL` 이 없는 프로바이더(원격 기본)는 **볼 주소가 없어** 건너뛴다 — 건너뛰기를
 * 실패로 적지 않는다.
 */
async function deadProviders(named: CountedProvider[], fetchImpl: typeof fetch): Promise<string[]> {
  const dead: string[] = []
  for (const provider of named) {
    if (provider.baseUrl === undefined || provider.baseUrl.trim() === '') continue
    if (await reachable(provider.baseUrl, fetchImpl)) continue
    dead.push(`${provider.id} (${hostOf(provider.baseUrl) ?? '주소 불명'})`)
  }
  return dead
}

/**
 * 주소가 응답을 하나. **상태 코드는 보지 않는다.**
 *
 * 실측: ollama 는 `GET http://127.0.0.1:11434/v1` 에 **404** 를 준다(그 경로엔 핸들러가 없다).
 * 데몬이 죽으면 연결 자체가 실패한다. 우리가 가르려는 것은 "200 이냐" 가 아니라 **"누가 받느냐"** 다.
 * OpenAI 호환 경로(`/models` 등)를 덧붙이지 않는 이유이기도 하다 — 프로바이더마다 다르고,
 * 없는 경로를 골랐다가 살아 있는 서버를 죽었다고 적으면 진단이 오진을 정답처럼 보여준다.
 */
async function reachable(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    await fetchImpl(url, { signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 화면에 내보낼 수 있는 부분만. **주소 원문을 그대로 쓰지 않는다** —
 * `https://user:pw@host` 같은 모양이면 자격증명이 그대로 진단 패널에 찍힌다.
 * 못 읽는 주소는 아예 내보내지 않는다.
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}
