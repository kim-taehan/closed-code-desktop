import { describe, expect, it, vi } from 'vitest'
import { fetchRegistryIndex } from './registryFetch'

// 배포처 조회. 폐쇄망에서 "안 보인다" 의 원인은 대개 주소 오타·망 미접속·서버 다운인데
// 고치는 방법이 전혀 다르다 — **사유를 갈라 돌려주는지**가 여기 핵심이다.

const INDEX_URL = 'http://registry.local/extensions/index.json'

const DOC = {
  registryVersion: 1,
  name: '사내 공통 배포처',
  extensions: [
    { name: 'a', latest: '1.0.0', versions: [{ version: '1.0.0', url: 'packages/a/1.0.0' }] },
  ],
}

/** 응답 하나를 흉내낸다. `url` 은 리다이렉트 후 최종 주소를 나타낸다 */
function respond(body: unknown, init: { status?: number; url?: string } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return vi.fn(async () => ({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    url: init.url ?? INDEX_URL,
    text: async () => text,
  })) as unknown as typeof fetch
}

describe('주소를 먼저 본다 — 네트워크를 건드리기 전에', () => {
  it('주소 모양이 아니면 부르지도 않는다', async () => {
    const fetchImpl = respond(DOC)
    const result = await fetchRegistryIndex({ url: 'not a url', fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'bad_url' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // 설정에 file: 이 들어와도 여기서 한 번 더 막는다
  it('http/https 가 아니면 거부한다', async () => {
    const fetchImpl = respond(DOC)
    const result = await fetchRegistryIndex({ url: 'file:///etc/passwd', fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'bad_url' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('주소를 그대로 쓴다', () => {
  // 덧붙이면 배포처가 그 경로를 강제당한다 (표준 §4.4)
  it('뒤에 /index.json 같은 것을 덧붙이지 않는다', async () => {
    const fetchImpl = respond(DOC, { url: 'http://registry.local/api/deployments/extensions' })
    await fetchRegistryIndex({
      url: 'http://registry.local/api/deployments/extensions',
      fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://registry.local/api/deployments/extensions',
      expect.anything(),
    )
  })
})

describe('실패 사유를 가른다', () => {
  it('못 닿으면 unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND registry.local')
    }) as unknown as typeof fetch
    const result = await fetchRegistryIndex({ url: INDEX_URL, fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'unreachable' })
    expect((result as { detail?: string }).detail).toContain('ENOTFOUND')
  })

  // 사내망에 안 붙은 채 조회하면 끊기지 않고 매달린다. 화면이 갇히느니 포기하는 편이 낫다
  it('시간을 넘기면 timeout — unreachable 과 가른다 (할 일이 다르다)', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('timed out')
      error.name = 'TimeoutError'
      throw error
    }) as unknown as typeof fetch
    const result = await fetchRegistryIndex({ url: INDEX_URL, fetchImpl, timeoutMs: 50 })
    expect(result).toMatchObject({ ok: false, reason: 'timeout', detail: '50ms' })
  })

  it('4xx/5xx 는 상태코드를 함께 준다', async () => {
    const result = await fetchRegistryIndex({
      url: INDEX_URL,
      fetchImpl: respond('nope', { status: 404 }),
    })
    expect(result).toMatchObject({ ok: false, reason: 'http_error', detail: 'HTTP 404' })
  })

  it('JSON 이 아니면 invalid_json', async () => {
    const result = await fetchRegistryIndex({
      url: INDEX_URL,
      fetchImpl: respond('<html>로그인 하세요</html>'),
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_json' })
  })

  it('파싱 실패 사유를 그대로 얹어 준다', async () => {
    const result = await fetchRegistryIndex({
      url: INDEX_URL,
      fetchImpl: respond({ registryVersion: 99, extensions: [] }),
    })
    expect(result).toMatchObject({ ok: false, reason: 'unsupported_registry_version' })
  })
})

describe('상대 URL 의 기준', () => {
  it('문서를 받은 주소를 기준으로 푼다', async () => {
    const result = await fetchRegistryIndex({ url: INDEX_URL, fetchImpl: respond(DOC) })
    expect(result).toMatchObject({ ok: true })
    const index = (result as { index: { entries: { versions: { url: string }[] }[] } }).index
    expect(index.entries[0]!.versions[0]!.url).toBe(
      'http://registry.local/extensions/packages/a/1.0.0',
    )
  })

  // 원래 주소로 풀면 옮겨간 배포처에서 엉뚱한 곳을 가리킨다
  it('리다이렉트를 따라갔으면 **최종** 주소가 기준이다', async () => {
    const result = await fetchRegistryIndex({
      url: INDEX_URL,
      fetchImpl: respond(DOC, { url: 'http://mirror.local/ext/index.json' }),
    })
    const index = (result as { index: { entries: { versions: { url: string }[] }[] } }).index
    expect(index.entries[0]!.versions[0]!.url).toBe('http://mirror.local/ext/packages/a/1.0.0')
  })
})

describe('content-type 을 믿지 않는다', () => {
  // 정적 파일로 올린 배포처는 text/plain 으로 주기도 한다. 실제로 JSON 이면 받아준다
  it('본문이 JSON 이면 받아준다', async () => {
    const result = await fetchRegistryIndex({ url: INDEX_URL, fetchImpl: respond(DOC) })
    expect(result.ok).toBe(true)
  })
})
