import { describe, expect, it, vi } from 'vitest'
import { callCount, fakeFetch, opencodeFetch, routedFetch, urlOf } from './probeFixtures'
import { checkModels } from './probe'

// `checkModels` 는 **세 겹**이다: 프로바이더·모델이 잡혀 있나 → 무엇을 골랐나(`GET /config`)
// → 그 주소가 살아 있나.
//
// ⚠️ **경로가 두 세대로 갈린다** (README 실측 함정 1·8): health 는 `/global` 판을 쓰고
// 설정 계열은 `/api` 판이 **없어** 레거시 표면(`/config`·`/config/providers`)을 쓴다.
// **한쪽에 맞춰 `/api` 를 붙이면 404 가 아니라 더 나쁘다** — 아래 참조.
//
// 서버 쪽(`pingOpencode`)은 300줄 상한 때문에 `probe.test.ts` 로 갈렸다.

describe('checkModels — 쓸 모델이 붙어 있나', () => {
  const providers = { providers: [{ id: 'ollama-local', models: { 'devstral:24b': {} } }] }

  // ⚠️ **`/api/config/providers` 가 아니다.** `/api` 판이 없어 레거시 표면을 쓴다
  // (`client.ts` 의 `providers()` 와 같은 판단).
  //
  // **틀리면 404 가 아니다 — 그보다 나쁘다.** 실측(1.17.18): `/api/config/providers` 는
  // **HTTP 200 에 웹 UI HTML** 을 준다 (라우트가 없어 SPA 폴백이 걸린다).
  // `response.ok` 가 **참**이라 코드가 그대로 진행하고, 화면에는 원인이 아니라 JSON 파싱
  // 오류가 뜬다. 상태 코드로는 못 가리므로 **URL 자체를 단언하는 것 말고는 그물이 없다.**
  // (`contract-qa` 가 1.14.28 의 `/api/health` 에서 같은 모양을 쟀다 — 16·17회차.)
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
    const impl = routedFetch({
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

// **여기가 D2 의 본체다.** `GET /config/providers` 는 순수 설정 목록이라 생사 필드가 없다
// (`id·name·source·env·options·models` 전수 확인). 그래서 **설정만 되고 죽은 프로바이더가
// 초록으로 지나갔다** — 실제로 밟았다: ollama 데몬이 안 떠 있었는데 진단은 "모든 계층 정상"
// 이었고 증상은 "턴이 답을 못 받는다" 였다.
describe('checkModels — 프로바이더 주소가 살아 있나 (두 번째 겹)', () => {
  const local = {
    providers: [
      {
        id: 'ollama-local',
        models: { 'devstral:24b': {} },
        options: { baseURL: 'http://127.0.0.1:11434/v1', apiKey: 'sk-super-secret' },
      },
    ],
  }

  it('baseURL 을 그대로 ping 한다', async () => {
    const impl = routedFetch(local)
    await checkModels('http://127.0.0.1:4096', impl)
    expect(urlOf(impl, 0)).toBe('http://127.0.0.1:4096/config/providers')
    expect(urlOf(impl, 1)).toBe('http://127.0.0.1:4096/config')
    expect(urlOf(impl, 2)).toBe('http://127.0.0.1:11434/v1')
  })

  it('설정은 됐는데 주소가 죽었으면 실패다', async () => {
    const impl = routedFetch(local, ['http://127.0.0.1:11434'])
    const result = await checkModels('http://127.0.0.1:4096', impl)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('ollama-local')
    expect(result.detail).toContain('127.0.0.1:11434')
  })

  // 죽은 프로바이더 문장은 **새로 생긴 유출 표면**이다 — 같은 응답에 apiKey 가 실려 온다
  it('죽었다는 문장에도 apiKey 를 안 싣는다', async () => {
    const impl = routedFetch(local, ['http://127.0.0.1:11434'])
    const result = await checkModels('http://127.0.0.1:4096', impl)
    expect(result.detail).not.toContain('sk-super-secret')
    expect(result.detail).not.toContain('apiKey')
  })

  // 자격증명이 주소에 박힌 모양. host 만 꺼내므로 사용자·비밀번호가 화면에 안 간다.
  it('주소에 자격증명이 박혀 있어도 host 만 적는다', async () => {
    const impl = routedFetch(
      { providers: [{ id: 'proxy', models: { m: {} }, options: { baseURL: 'https://u:pw@proxy.example/v1' } }] },
      ['https://u:pw@proxy.example'],
    )
    const result = await checkModels('http://127.0.0.1:4096', impl)
    expect(result.detail).toContain('proxy.example')
    expect(result.detail).not.toContain('pw@')
  })

  // **200 이 아니어도 살아 있는 것이다.** 실측: ollama 는 `GET {baseURL}` 에 404 를 준다.
  // 상태 코드로 가르면 멀쩡한 서버를 죽었다고 적는다.
  it('404 를 줘도 응답이 왔으면 살아 있는 것이다', async () => {
    const impl = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/config/providers')
          ? { ok: true, status: 200, json: () => Promise.resolve(local) }
          : { ok: false, status: 404, json: () => Promise.resolve({}) },
      ),
    ) as unknown as typeof fetch
    expect((await checkModels('http://127.0.0.1:4096', impl)).ok).toBe(true)
  })

  // 원격 기본 프로바이더(`opencode`)에는 baseURL 이 없다 — 볼 주소가 없어 건너뛴다.
  // **건너뛰기를 실패로 적지 않는다.** 호출은 providers·config 둘로 끝난다.
  it('baseURL 이 없는 프로바이더는 ping 을 건너뛴다', async () => {
    const impl = routedFetch({ providers: [{ id: 'opencode', models: { 'big-pickle': {} } }] })
    const result = await checkModels('http://127.0.0.1:4096', impl)
    expect(result.ok).toBe(true)
    expect(callCount(impl)).toBe(2)
  })

  // ⚠️ **「하나만 살아 있으면 통과」로 하면 원래 잡으려던 실패를 놓친다.**
  // 실측 설정이 정확히 이 모양이다 — 원격 `opencode` 가 항상 초록이라 ollama 가 죽어도
  // 그 규칙이면 초록이 된다. 그래서 물러났을 때는 baseURL 이 있는 것이 **전부** 살아 있어야 한다.
  // (`routedFetch` 는 `/config` 에도 providers 본문을 주므로 `model` 이 없다 — **물러난 경로**다.)
  it('못 고르면 전부를 본다 — 원격이 같이 있어도 죽은 로컬 하나면 실패다', async () => {
    const impl = routedFetch(
      {
        providers: [
          { id: 'opencode', models: { 'big-pickle': {} } },
          { id: 'ollama-local', models: { 'devstral:24b': {} }, options: { baseURL: 'http://127.0.0.1:11434/v1' } },
        ],
      },
      ['http://127.0.0.1:11434'],
    )
    const result = await checkModels('http://127.0.0.1:4096', impl)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('ollama-local')
  })

  // 모델이 0개인 프로바이더는 애초에 세지 않으므로 ping 대상도 아니다
  it('모델이 없는 프로바이더의 주소는 ping 하지 않는다', async () => {
    const impl = routedFetch({
      providers: [
        { id: 'empty', models: {}, options: { baseURL: 'http://127.0.0.1:11434/v1' } },
        { id: 'opencode', models: { m: {} } },
      ],
    })
    await checkModels('http://127.0.0.1:4096', impl)
    expect(callCount(impl)).toBe(2)
  })
})

// **고른 프로바이더 하나만 본다.** 전부 보면 셋을 넣고 하나만 쓰는 사람에게 진단이 늘
// 빨갛고, 그러면 그 화면을 안 보게 되어 정작 필요할 때 못 쓴다.
//
// 선택은 `GET /config` 의 `model` 이 그대로 준다 — `"ollama-local/devstral:24b"` (실측 1.17.18,
// `opencode.ai/config.json` 스키마: *"Model to use in the format of provider/model"*).
// IPC 계약을 넓히지 않아도 된다.
describe('checkModels — 무엇을 골랐는지는 /config 가 준다', () => {
  const two = {
    providers: [
      { id: 'ollama-local', models: { 'devstral:24b': {} }, options: { baseURL: 'http://127.0.0.1:11434/v1' } },
      { id: 'other-local', models: { m: {} }, options: { baseURL: 'http://127.0.0.1:9999/v1' } },
    ],
  }

  it('고른 프로바이더만 ping 하고 나머지는 안 본다', async () => {
    const impl = opencodeFetch(two, { model: 'ollama-local/devstral:24b' })
    await checkModels('http://127.0.0.1:4096', impl)
    expect(urlOf(impl, 2)).toBe('http://127.0.0.1:11434/v1')
    expect(callCount(impl)).toBe(3) // providers · config · 고른 것 하나
  })

  // ⭐ 이것이 「전부」 규칙을 「고른 것」으로 바꾼 이유다 — 안 쓰는 쪽이 죽어도 초록이어야 한다
  it('안 고른 프로바이더가 죽어 있어도 통과다', async () => {
    const impl = opencodeFetch(two, { model: 'ollama-local/devstral:24b' }, ['http://127.0.0.1:9999'])
    expect((await checkModels('http://127.0.0.1:4096', impl)).ok).toBe(true)
  })

  it('고른 프로바이더가 죽어 있으면 실패다', async () => {
    const impl = opencodeFetch(two, { model: 'ollama-local/devstral:24b' }, ['http://127.0.0.1:11434'])
    const result = await checkModels('http://127.0.0.1:4096', impl)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('ollama-local')
    expect(result.detail).not.toContain('other-local')
  })

  // **첫 `/` 에서만 자른다** — 모델 id 에 `/` 가 들어가는 게이트웨이가 있다 (`models.ts` 주석).
  // 마지막 `/` 로 자르면 프로바이더가 `openrouter/anthropic` 이 되어 목록에 없고, 조용히
  // 「전부」로 물러난다 — 틀렸는데 초록으로 보이는 모양이다.
  it('모델 id 에 / 가 들어가도 프로바이더를 옳게 가른다', async () => {
    const gateway = {
      providers: [
        { id: 'openrouter', models: { 'anthropic/claude-3': {} }, options: { baseURL: 'http://127.0.0.1:8080/v1' } },
        { id: 'other-local', models: { m: {} }, options: { baseURL: 'http://127.0.0.1:9999/v1' } },
      ],
    }
    const impl = opencodeFetch(gateway, { model: 'openrouter/anthropic/claude-3' })
    await checkModels('http://127.0.0.1:4096', impl)
    expect(urlOf(impl, 2)).toBe('http://127.0.0.1:8080/v1')
    expect(callCount(impl)).toBe(3)
  })

  describe('못 고르면 전부로 물러난다 — 무엇을 쓸지 모르면 넓게 본다', () => {
    it('config.model 이 없을 때', async () => {
      const impl = opencodeFetch(two, {}, ['http://127.0.0.1:9999'])
      expect((await checkModels('http://127.0.0.1:4096', impl)).ok).toBe(false)
    })

    it('config.model 이 provider/model 모양이 아닐 때', async () => {
      const impl = opencodeFetch(two, { model: 'devstral' }, ['http://127.0.0.1:9999'])
      expect((await checkModels('http://127.0.0.1:4096', impl)).ok).toBe(false)
    })

    it('고른 프로바이더가 목록에 없을 때', async () => {
      const impl = opencodeFetch(two, { model: 'nope/x' }, ['http://127.0.0.1:9999'])
      expect((await checkModels('http://127.0.0.1:4096', impl)).ok).toBe(false)
    })

    // /config 를 못 읽었다고 model 단계를 실패시키지 않는다 — 프로바이더 목록은 이미 받았다
    it('/config 를 못 읽을 때 — 그것 자체는 실패가 아니다', async () => {
      const impl = opencodeFetch(two, null)
      expect((await checkModels('http://127.0.0.1:4096', impl)).ok).toBe(true)
      expect(callCount(impl)).toBe(4) // providers · config(실패) · 둘 다 ping
    })
  })
})
