import { describe, expect, it } from 'vitest'
import { callCount, opencodeFetch, urlOf } from './probeFixtures'
import { checkModels } from './probe'

// **어느 프로바이더를 볼 것인가** — 「고른 것이 살아 있나」(probeModels.test.ts)와 갈라 둔다.
// 300줄 상한 때문이기도 하지만, 두 물음은 **틀리는 방식이 다르다**:
// 고르기가 틀리면 **초록인 채로** 틀리고, 생사 판정이 틀리면 빨간색으로 틀린다.
//
// 규칙은 `configChoice.ts` 에 있고, 여기서는 `checkModels` 가 그 규칙을 실제로 쓰는지 본다.

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

// **M1 — 좁히면서 생긴 구멍.** `config.model` 하나만 보면 거짓 초록이 난다.
// `contract-qa` 가 실서버로 재현했다 (20회차): `model` 은 살아 있고 `agent.build.model` 이
// 죽은 프로바이더를 가리키는데 진단이 **초록**이었다. `build` 는 기본 primary 에이전트다.
//
// 후보를 `model` ∪ `small_model` ∪ `agent.*.model` ∪ `mode.*.model` 로 넓혀 막는다 —
// **「전부」로 되돌아가는 게 아니라 「실제로 쓰일 수 있는 것들」로 넓히는 것**이다.
// 새 호출은 없다: 같은 `/config` 응답 안에 다 들어 있다.
describe('checkModels — 오버라이드가 가리키는 프로바이더도 본다 (M1)', () => {
  const three = {
    providers: [
      { id: 'ollama-local', models: { 'devstral:24b': {} }, options: { baseURL: 'http://127.0.0.1:11434/v1' } },
      { id: 'fake-remote', models: { 'ghost:1b': {} }, options: { baseURL: 'http://127.0.0.1:59998/v1' } },
      { id: 'unused', models: { m: {} }, options: { baseURL: 'http://127.0.0.1:9999/v1' } },
    ],
  }
  const dead = ['http://127.0.0.1:59998']

  // ⭐ QA 가 재현한 설정 그대로 — 이것이 초록이면 D2 가 막으려던 실패가 그대로 지나간다
  it('agent.*.model 이 가리키는 프로바이더가 죽어 있으면 실패다', async () => {
    const impl = opencodeFetch(
      three,
      { model: 'ollama-local/devstral:24b', agent: { build: { model: 'fake-remote/ghost:1b' } } },
      dead,
    )
    const result = await checkModels('http://127.0.0.1:4096', impl)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('fake-remote')
  })

  it('small_model 이 가리키는 프로바이더도 본다', async () => {
    const impl = opencodeFetch(
      three,
      { model: 'ollama-local/devstral:24b', small_model: 'fake-remote/ghost:1b' },
      dead,
    )
    expect((await checkModels('http://127.0.0.1:4096', impl)).ok).toBe(false)
  })

  // `mode` 는 스키마상 `@deprecated Use agent field instead` 지만 같은 AgentConfig 라
  // 옛 설정에 남아 있으면 그대로 산다
  it('deprecated 인 mode.*.model 도 본다', async () => {
    const impl = opencodeFetch(
      three,
      { model: 'ollama-local/devstral:24b', mode: { build: { model: 'fake-remote/ghost:1b' } } },
      dead,
    )
    expect((await checkModels('http://127.0.0.1:4096', impl)).ok).toBe(false)
  })

  // ⭐ 넓혔지만 **「전부」로 되돌아간 것이 아니다** — 아무도 안 가리키는 것은 죽어도 초록이다
  it('아무 설정도 안 가리키는 프로바이더는 죽어도 통과다', async () => {
    const impl = opencodeFetch(
      three,
      { model: 'ollama-local/devstral:24b', agent: { build: { model: 'fake-remote/ghost:1b' } } },
      ['http://127.0.0.1:9999'], // unused 만 죽였다
    )
    expect((await checkModels('http://127.0.0.1:4096', impl)).ok).toBe(true)
  })

  it('같은 프로바이더를 여러 곳이 가리켜도 한 번만 ping 한다', async () => {
    const impl = opencodeFetch(three, {
      model: 'ollama-local/devstral:24b',
      small_model: 'ollama-local/devstral:24b',
      agent: { build: { model: 'ollama-local/devstral:24b' } },
    })
    await checkModels('http://127.0.0.1:4096', impl)
    expect(callCount(impl)).toBe(3) // providers · config · ping 한 번
  })

  // 오버라이드가 목록에 없는 프로바이더를 가리키면 ping 할 주소가 없다 — 물러나지 않는다
  it('오버라이드가 모르는 프로바이더를 가리켜도 아는 것은 계속 본다', async () => {
    const impl = opencodeFetch(
      three,
      { model: 'ollama-local/devstral:24b', agent: { build: { model: 'nope/x' } } },
      ['http://127.0.0.1:11434'],
    )
    const result = await checkModels('http://127.0.0.1:4096', impl)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('ollama-local')
  })
})
