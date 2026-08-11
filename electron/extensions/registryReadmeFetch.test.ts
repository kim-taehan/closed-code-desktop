import { describe, expect, it, vi } from 'vitest'
import { fetchRegistryReadme } from './registryReadmeFetch'

// 받기 전에 보는 설명. 배포처는 신뢰 경계 **밖**이라 여기서 지키는 것은 셋이다:
//   1. 주소를 네트워크 전에 거른다 (file:·data: 는 배포처 문서 한 줄로 로컬 파일을 겨눈다)
//   2. 크기 상한 — 설명 하나가 IPC 와 화면을 가득 채우지 않게
//   3. 사유를 갈라 돌려준다 (설치본 README 와 같은 규율)

const URL_OK = 'http://registry.local/packages/a/1.0.0/readme'

function respond(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return vi.fn(async () => ({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    text: async () => body,
  })) as unknown as typeof fetch
}

describe('주소를 먼저 본다', () => {
  it('주소 모양이 아니면 부르지도 않는다', async () => {
    const fetchImpl = respond('# hi')
    const result = await fetchRegistryReadme({ url: 'not a url', fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'bad_url' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // 파서가 이미 걸렀지만 이 함수는 IPC 로도 불린다 — 인자는 renderer 를 거쳐 온다
  it('http/https 가 아니면 거부한다', async () => {
    const fetchImpl = respond('# hi')
    const result = await fetchRegistryReadme({ url: 'file:///etc/passwd', fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'bad_url' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('받아온다', () => {
  it('본문을 그대로 돌려준다', async () => {
    const result = await fetchRegistryReadme({ url: URL_OK, fetchImpl: respond('# 라인 체커') })
    expect(result).toEqual({ ok: true, text: '# 라인 체커' })
  })

  // 404 를 "설명 없음" 으로 바꾸면 배포처가 틀린 채로 남는다
  it('404 는 오류다 — 조용히 정상으로 만들지 않는다', async () => {
    const result = await fetchRegistryReadme({
      url: URL_OK,
      fetchImpl: respond('', { status: 404 }),
    })
    expect(result).toMatchObject({ ok: false, reason: 'http_error', detail: 'HTTP 404' })
  })
})

describe('크기 상한 — 설치본 README 와 같은 값', () => {
  it('미리 밝힌 크기가 넘으면 본문을 읽지 않는다', async () => {
    const fetchImpl = respond('x', { headers: { 'content-length': String(300 * 1024) } })
    const result = await fetchRegistryReadme({ url: URL_OK, fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'too_large' })
  })

  // 정적 파일 서버는 크기를 안 밝히기도 한다 — 읽은 뒤에 한 번 더 잰다
  it('크기를 안 밝혀도 받은 것이 넘으면 거부한다', async () => {
    const fetchImpl = respond('가'.repeat(200 * 1024)) // utf8 로 3바이트씩
    const result = await fetchRegistryReadme({ url: URL_OK, fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'too_large' })
  })
})

describe('못 닿는 것과 느린 것을 가른다', () => {
  it('시간 초과', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    }) as unknown as typeof fetch
    const result = await fetchRegistryReadme({ url: URL_OK, fetchImpl, timeoutMs: 50 })
    expect(result).toMatchObject({ ok: false, reason: 'timeout', detail: '50ms' })
  })

  it('아예 못 닿음', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const result = await fetchRegistryReadme({ url: URL_OK, fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'unreachable', detail: 'ECONNREFUSED' })
  })
})
