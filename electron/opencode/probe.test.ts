import { describe, expect, it, vi } from 'vitest'
import { checkModels, pingOpencode } from './probe'

// **진단이 실제로 무엇을 호출하는가 — URL 을 문자열로 단언한다.**
//
// 이 레포가 오늘 두 번 밟은 자리다: `POST /mcp` 에 `location[directory]=`(pty 표면 이름)를
// 잘못 써도 **HTTP 200 이 났고**, 증상은 한참 뒤에야 다른 모양으로 나타났다.
// 진단은 그보다 나쁘다 — 틀린 주소로 물어 실패하면 화면에 **"서버가 안 떠 있습니다"** 라고
// 뜨므로, **오진이 정답처럼 보인다.**
//
// 그래서 응답 해석만 보지 않고 `fetchImpl` 이 받은 URL 자체를 본다.
//
// ⚠️ **경로가 두 세대로 갈린다** (README 실측 함정 1·8): health 는 `/api` 판을 쓰고
// providers 는 `/api` 판이 **없어** 레거시 표면을 쓴다. 한쪽에 맞춰 통일하면 404 다.

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch
}

function urlOf(impl: typeof fetch, call = 0): string {
  return (impl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[call]![0]
}

describe('pingOpencode — 서버가 떠 있나', () => {
  it('GET {base}/api/health 를 부른다', async () => {
    const impl = fakeFetch({ healthy: true })
    await pingOpencode('http://127.0.0.1:4096', impl)
    expect(urlOf(impl)).toBe('http://127.0.0.1:4096/api/health')
  })

  // 끝의 / 를 안 떼면 `//api/health` 가 되어 404 다 (opencode/client.ts 와 같은 함정)
  it('주소 끝의 / 를 떼고 붙인다', async () => {
    const impl = fakeFetch({ healthy: true })
    await pingOpencode('http://127.0.0.1:4096///', impl)
    expect(urlOf(impl)).toBe('http://127.0.0.1:4096/api/health')
  })

  it('healthy 면 통과하고 주소를 detail 에 적는다', async () => {
    const result = await pingOpencode('http://127.0.0.1:4096', fakeFetch({ healthy: true }))
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('127.0.0.1:4096')
  })

  // 200 인데 healthy 가 아닌 응답 — 다른 서버가 그 포트를 잡고 있을 때 이렇게 온다
  it('응답은 왔는데 healthy 가 아니면 실패다', async () => {
    const result = await pingOpencode('http://127.0.0.1:4096', fakeFetch({ healthy: false }))
    expect(result.ok).toBe(false)
    expect(result.detail).toBe('health 응답이 healthy 가 아닙니다')
  })

  it('빈 주소는 호출조차 하지 않는다', async () => {
    const impl = fakeFetch({ healthy: true })
    const result = await pingOpencode('   ', impl)
    expect(result.ok).toBe(false)
    expect(impl).not.toHaveBeenCalled()
  })

  // 화면에 그대로 뜨는 문장이다 — 다음 행동을 함께 적어야 한다
  it('못 닿으면 사유에 `opencode serve` 안내를 붙인다', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch
    const result = await pingOpencode('http://127.0.0.1:4096', impl)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('fetch failed')
    expect(result.detail).toContain('opencode serve')
  })

  // abort 는 "느리다" 가 아니라 "안 떠 있다" 일 때가 대부분이라 그렇게 읽히게 쓴다
  it('시간 초과는 응답이 없다고 적는다', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const impl = vi.fn().mockRejectedValue(abort) as unknown as typeof fetch
    const result = await pingOpencode('http://127.0.0.1:4096', impl)
    expect(result.detail).toContain('응답이 없습니다')
  })

  it('HTTP 오류도 실패다', async () => {
    const result = await pingOpencode('http://127.0.0.1:4096', fakeFetch({}, false))
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('HTTP 500')
  })
})

describe('checkModels — 쓸 모델이 붙어 있나', () => {
  const providers = { providers: [{ id: 'ollama-local', models: { 'devstral:24b': {} } }] }

  // ⚠️ **`/api/config/providers` 가 아니다.** `/api` 판이 없어 레거시 표면을 쓴다
  // (`client.ts` 의 `providers()` 와 같은 판단). 붙이면 404 이고, 화면에는
  // "설정된 모델이 없습니다" 가 아니라 "HTTP 404" 로 뜬다 — 원인을 못 가린다.
  it('GET {base}/config/providers 를 부른다', async () => {
    const impl = fakeFetch(providers)
    await checkModels('http://127.0.0.1:4096', impl)
    expect(urlOf(impl)).toBe('http://127.0.0.1:4096/config/providers')
    expect(urlOf(impl)).not.toContain('/api/config')
  })

  it('주소 끝의 / 를 떼고 붙인다', async () => {
    const impl = fakeFetch(providers)
    await checkModels('http://127.0.0.1:4096/', impl)
    expect(urlOf(impl)).toBe('http://127.0.0.1:4096/config/providers')
  })

  it('모델이 있으면 프로바이더와 개수를 적는다', async () => {
    const result = await checkModels('http://127.0.0.1:4096', fakeFetch(providers))
    expect(result.ok).toBe(true)
    expect(result.detail).toBe('ollama-local (1)')
  })

  it('여러 프로바이더를 쉼표로 잇는다', async () => {
    const impl = fakeFetch({
      providers: [
        { id: 'ollama-local', models: { a: {}, b: {} } },
        { id: 'opencode', models: { c: {} } },
      ],
    })
    expect((await checkModels('http://127.0.0.1:4096', impl)).detail).toBe(
      'ollama-local (2), opencode (1)',
    )
  })

  // 프로바이더가 있어도 모델이 0개면 쓸 것이 없다
  it('모델이 0개인 프로바이더는 세지 않는다', async () => {
    const impl = fakeFetch({ providers: [{ id: 'empty', models: {} }] })
    const result = await checkModels('http://127.0.0.1:4096', impl)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('~/.config/opencode/opencode.json')
  })

  it('목록이 비면 설정 파일을 안내한다', async () => {
    const result = await checkModels('http://127.0.0.1:4096', fakeFetch({ providers: [] }))
    expect(result.ok).toBe(false)
  })

  // 응답 모양이 세 가지로 올 수 있어 전부 받는다 (배열 · {providers} · {data})
  describe('응답 모양 세 가지를 다 받는다', () => {
    const one = [{ id: 'p', models: { m: {} } }]

    it('맨 배열', async () => {
      expect((await checkModels('http://x', fakeFetch(one))).ok).toBe(true)
    })
    it('{ providers }', async () => {
      expect((await checkModels('http://x', fakeFetch({ providers: one }))).ok).toBe(true)
    })
    it('{ data }', async () => {
      expect((await checkModels('http://x', fakeFetch({ data: one }))).ok).toBe(true)
    })
  })

  it('빈 주소는 호출조차 하지 않는다', async () => {
    const impl = fakeFetch(providers)
    expect((await checkModels('  ', impl)).ok).toBe(false)
    expect(impl).not.toHaveBeenCalled()
  })

  // ⚠️ **`GET /config/providers` 응답에는 `apiKey` 가 실려 온다** (실측).
  // 진단 패널은 사람이 스크린샷을 찍어 공유하는 화면이라, 그 값이 detail 로 새면 안 된다.
  it('응답에 apiKey 가 있어도 detail 에 안 싣는다', async () => {
    const impl = fakeFetch({
      providers: [
        {
          id: 'ollama-local',
          models: { 'devstral:24b': {} },
          options: { baseURL: 'http://127.0.0.1:11434/v1', apiKey: 'sk-super-secret' },
        },
      ],
    })
    const result = await checkModels('http://127.0.0.1:4096', impl)

    expect(result.detail).not.toContain('sk-super-secret')
    expect(result.detail).not.toContain('apiKey')
  })
})
