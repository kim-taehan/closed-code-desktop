import {
  parseRegistryIndex,
  type RegistryIndex,
  type RegistryParseFailure,
} from '../../shared/extensions/registryIndex'

// 배포처 목록 문서를 받아온다. 표준 §4.4.
//
// **주소를 그대로 쓴다.** 뒤에 `/index.json` 같은 것을 덧붙이지 않는다 — 덧붙이면
// 배포처가 그 경로를 강제당하고, Admin(`/api/deployments/extensions`)이든 파일 공유든
// 어디서든 배포처가 될 수 있다는 전제가 깨진다.
//
// 사유를 갈라 돌려주는 이유: 폐쇄망에서 배포처가 안 보이는 원인은 대개 **주소 오타·사내망
// 미접속·서버 다운** 셋 중 하나인데, 고치는 방법이 전혀 다르다. "조회 실패" 한 줄로 뭉뚱그리면
// 사용자가 어디를 봐야 할지 모른다.

/** 목록을 못 받은 사유. 파싱 실패(`RegistryParseFailure`)까지 그대로 얹는다. */
export type RegistryFetchFailure =
  | 'bad_url'
  | 'unreachable'
  | 'timeout'
  | 'http_error'
  | 'invalid_json'
  | RegistryParseFailure

export type RegistryFetchResult =
  | { ok: true; index: RegistryIndex }
  | { ok: false; reason: RegistryFetchFailure; detail?: string }

export interface RegistryFetchOptions {
  url: string
  /**
   * 응답이 없을 때 포기하는 시간.
   *
   * 기본값을 넉넉히 두지 않는다 — 폐쇄망에서 사내망에 안 붙은 채로 조회하면 **끊기지 않고
   * 매달린다.** 화면이 "불러오는 중…" 에 갇히느니 10초에 포기하고 사유를 보여주는 편이 낫다.
   */
  timeoutMs?: number
  /** 시험에서 갈아끼운다. 기본은 전역 fetch */
  fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 10_000

export async function fetchRegistryIndex(
  options: RegistryFetchOptions,
): Promise<RegistryFetchResult> {
  const { url, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = options

  // 주소를 먼저 본다 — 네트워크를 건드리기 전에 걸러낼 수 있는 것이다
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return { ok: false, reason: 'bad_url', detail: url }
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, reason: 'bad_url', detail: parsedUrl.protocol }
  }

  let response: Response
  try {
    response = await fetchImpl(parsedUrl.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    // 시간 초과와 아예 못 닿는 것은 사용자가 할 일이 다르다 (기다렸다 다시 / 주소·망 확인)
    return isTimeout(error)
      ? { ok: false, reason: 'timeout', detail: `${timeoutMs}ms` }
      : { ok: false, reason: 'unreachable', detail: describe(error) }
  }

  if (!response.ok) {
    return { ok: false, reason: 'http_error', detail: `HTTP ${response.status}` }
  }

  // content-type 을 믿지 않는다. 정적 파일로 올린 배포처는 text/plain 으로 주기도 한다 —
  // 실제로 JSON 이면 받아준다. 판정은 파싱이 한다.
  let data: unknown
  try {
    data = JSON.parse(await response.text())
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }

  // 상대 URL 의 기준은 **최종 응답 주소**다. 리다이렉트를 따라갔다면 그쪽이 기준이 된다 —
  // 원래 주소로 풀면 옮겨간 배포처에서 엉뚱한 곳을 가리킨다.
  const base = response.url !== '' ? response.url : parsedUrl.toString()
  const parsed = parseRegistryIndex(data, base)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }

  return { ok: true, index: parsed.index }
}

function isTimeout(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    ((error as { name?: unknown }).name === 'TimeoutError' ||
      (error as { name?: unknown }).name === 'AbortError')
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
