import { originOf } from '../../shared/extensions/manifestNetwork'

// `code.http.fetch` 의 실제 호출. **main 에서 돈다** — 자식(확장 호스트)이 아니다.
//
// 확장이 바깥에 닿는 유일한 길이다 (확장 재설계 §8 을 「허용 목록의 출처만, 호스트를 거쳐」로 바꿨다,
// 하이닉스 요구사항 확장 §5-1). 자식에서 부르게 두면 울타리가 확장 코드와 한 프로세스에 있어
// 확장이 `require('https')` 한 줄로 넘는다 — 그래서 판정과 호출을 **둘 다** 여기 둔다.
// (자식이 `require('https')` 를 직접 쓰는 것까지 이 파일이 막지는 못한다. 그것은 확장 호스트가
// 샌드박스가 아니라는 표준 §4.2 의 전제 그대로다 — 막는 것은 **호스트가 대신 부르는 길**이다.)
//
// 웹뷰의 `connect-src 'none'` 은 **그대로다.** 부르는 것은 뒷단뿐이고, 앞단은 메시지로 받는다.
//
// 지키는 것:
//  - 출처(scheme+host+port)가 매니페스트 `network` 에 **정확히** 있어야 한다 (`manifestNetwork.ts`)
//  - 넘겨주기(3xx)를 **저절로 따라가지 않는다** — 행선지도 허용 목록에 있을 때만 따라가고, 아니면 거절
//  - 쿠키를 **담아 두지 않는다** — 부를 때마다 빈 손이다 (Node `fetch` 는 쿠키 통을 안 든다)
//  - 응답 10MB · 시간 기본 30초, 최대 120초 (넘겨주기와 본문 읽기까지 합친 시간)
//  - 바이트는 양쪽 다 base64 로 나른다 — 여러 조각 본문(첨부 올리기)은 확장이 만들고 호스트는 나르기만 한다

export const HTTP_MAX_RESPONSE_BYTES = 10 * 1024 * 1024
export const HTTP_DEFAULT_TIMEOUT_MS = 30_000
export const HTTP_MAX_TIMEOUT_MS = 120_000
/** 따라갈 넘겨주기 수. 허용 목록 안에서 도는 고리를 끊는다 */
const MAX_REDIRECTS = 5

export interface HttpFetchRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: Uint8Array
  timeoutMs: number
}

/** 본문은 글이면 `body`, 아니면 `bodyBase64` — 어느 쪽인지는 `content-type` 이 정한다 (`isText`) */
export interface HttpFetchResult {
  status: number
  headers: Record<string, string>
  body?: string
  bodyBase64?: string
}

/** 자식이 보낸 인자를 요청으로. 모양이 틀리면 **던진다** — 눙쳐서 부르면 확장이 엉뚱한 답을 받는다 */
export function parseHttpRequest(method: string, params: Record<string, unknown>): HttpFetchRequest {
  const url = params['url']
  if (typeof url !== 'string' || url === '') throw new Error(`${method}: url 은 문자열이어야 합니다`)
  const verb = params['method'] ?? 'GET'
  if (typeof verb !== 'string' || !/^[A-Za-z]+$/.test(verb)) throw new Error(`${method}: method 가 올바르지 않습니다`)
  const headers = params['headers'] ?? {}
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new Error(`${method}: headers 는 { 이름: 값 } 이어야 합니다`)
  }
  for (const value of Object.values(headers)) {
    if (typeof value !== 'string') throw new Error(`${method}: headers 의 값은 문자열이어야 합니다`)
  }
  const timeoutMs = params['timeoutMs'] ?? HTTP_DEFAULT_TIMEOUT_MS
  if (typeof timeoutMs !== 'number' || !(timeoutMs > 0) || timeoutMs > HTTP_MAX_TIMEOUT_MS) {
    throw new Error(`${method}: timeoutMs 는 0 보다 크고 ${HTTP_MAX_TIMEOUT_MS} 이하여야 합니다`)
  }
  const body = bodyOf(method, params['body'], params['bodyBase64'])
  return {
    url,
    method: verb.toUpperCase(),
    headers: headers as Record<string, string>,
    ...(body === undefined ? {} : { body }),
    timeoutMs,
  }
}

function bodyOf(method: string, text: unknown, base64: unknown): Uint8Array | undefined {
  if (text !== undefined && base64 !== undefined) throw new Error(`${method}: body 와 bodyBase64 는 하나만 줍니다`)
  if (text !== undefined) {
    if (typeof text !== 'string') throw new Error(`${method}: body 는 문자열이어야 합니다`)
    return new TextEncoder().encode(text)
  }
  if (base64 === undefined) return undefined
  // `Buffer.from(…, 'base64')` 는 틀린 글자를 **조용히 건너뛴다** — 첨부가 깨진 채 올라간다
  if (typeof base64 !== 'string' || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error(`${method}: bodyBase64 가 base64 가 아닙니다`)
  }
  return Buffer.from(base64, 'base64')
}

/**
 * 허용된 출처로만 부른다. 거절·시간 초과·크기 초과는 전부 사유와 함께 **던진다.**
 * HTTP 오류 상태(4xx·5xx)는 던지지 않는다 — 그것은 서버의 답이고 확장이 읽어야 한다.
 */
export async function fetchAllowed(allowed: readonly string[], request: HttpFetchRequest): Promise<HttpFetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), request.timeoutMs)
  try {
    return await follow(allowed, request, controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`http.fetch: 시간 초과 (${request.timeoutMs}ms) — ${request.url}`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function follow(allowed: readonly string[], first: HttpFetchRequest, signal: AbortSignal): Promise<HttpFetchResult> {
  let request = first
  for (let hop = 0; ; hop += 1) {
    const origin = originOf(request.url)
    if (origin === null) throw new Error(`http.fetch: http(s) 주소가 아닙니다 — ${request.url}`)
    if (!allowed.includes(origin)) {
      const why = hop === 0 ? '매니페스트 network 에 없는 출처입니다' : '넘겨주기 행선지가 network 에 없는 출처입니다'
      throw new Error(`http.fetch: ${why} — ${origin}`)
    }
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      redirect: 'manual',
      signal,
    })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || location === null) return read(response)
    await response.body?.cancel()
    if (hop >= MAX_REDIRECTS) throw new Error(`http.fetch: 넘겨주기가 ${MAX_REDIRECTS}번을 넘었습니다`)
    request = redirected(request, new URL(location, request.url).href, response.status)
  }
}

/**
 * 넘겨주기 다음 요청. 규칙은 fetch 표준과 같다 — 303 과 POST 의 301·302 는 본문 없는 GET 이 된다.
 * **출처가 바뀌면 `authorization` 을 떼어 낸다** — 둘 다 허용 목록 안이라도 토큰은 적은 출처의 것이다.
 */
function redirected(previous: HttpFetchRequest, url: string, status: number): HttpFetchRequest {
  const asGet = status === 303 || ((status === 301 || status === 302) && previous.method === 'POST')
  const sameOrigin = originOf(url) === originOf(previous.url)
  const headers = Object.fromEntries(
    Object.entries(previous.headers).filter(([name]) => sameOrigin || name.toLowerCase() !== 'authorization'),
  )
  if (!asGet) return { ...previous, url, headers }
  return { url, method: 'GET', headers, timeoutMs: previous.timeoutMs }
}

async function read(response: Response): Promise<HttpFetchResult> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, name) => {
    headers[name] = value
  })
  const declared = Number(response.headers.get('content-length'))
  if (declared > HTTP_MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw tooLarge()
  }
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body?.getReader()
  // 선언이 없거나 거짓일 수 있다 — 받는 대로 세어 넘는 순간 끊는다
  while (reader !== undefined) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > HTTP_MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  const bytes = Buffer.concat(chunks)
  return isText(headers['content-type'])
    ? { status: response.status, headers, body: bytes.toString('utf8') }
    : { status: response.status, headers, bodyBase64: bytes.toString('base64') }
}

function tooLarge(): Error {
  return new Error(`http.fetch: 응답이 ${HTTP_MAX_RESPONSE_BYTES / 1024 / 1024}MB 를 넘었습니다`)
}

/**
 * 글로 돌려줄 응답인가. **`content-type` 만 본다** — 바이트를 들여다보고 추측하면 같은 주소가
 * 내용에 따라 두 모양으로 와서 확장이 두 갈래를 다 짜야 한다. 없으면 바이트(base64)로 준다.
 */
function isText(contentType: string | undefined): boolean {
  if (contentType === undefined) return false
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return (
    type.startsWith('text/') ||
    /[/+](json|xml)$/.test(type) ||
    type === 'application/javascript' ||
    type === 'application/x-www-form-urlencoded'
  )
}
