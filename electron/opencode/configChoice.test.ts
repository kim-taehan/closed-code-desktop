import { describe, expect, it } from 'vitest'
import { providerIdsOf } from './configChoice'

// 고르는 규칙 자체. HTTP 없이 단언한다 — 이 규칙이 틀리면 **초록인 채로** 틀리기 때문에
// 통합 쪽(`probeChoice.test.ts`)만으로는 경우를 다 못 깐다.

describe('providerIdsOf — 설정이 쓸 수 있는 프로바이더들', () => {
  it('config.model 의 프로바이더를 준다', () => {
    expect(providerIdsOf({ model: 'ollama-local/devstral:24b' })).toEqual(['ollama-local'])
  })

  // ⭐ M1 — 이 한 줄이 빠져 있어서 거짓 초록이 났다 (contract-qa 20회차 재현).
  // `build` 는 기본 primary 에이전트라, 그 세션이 실제로 쓰는 프로바이더가 죽어도 초록이었다.
  it('agent.*.model 도 모은다', () => {
    expect(
      providerIdsOf({
        model: 'ollama-local/devstral:24b',
        agent: { build: { model: 'fake-remote/ghost:1b' } },
      }),
    ).toEqual(['ollama-local', 'fake-remote'])
  })

  it('small_model 도 모은다', () => {
    expect(providerIdsOf({ model: 'a/x', small_model: 'b/y' })).toEqual(['a', 'b'])
  })

  // `mode` 는 스키마상 `@deprecated Use agent field instead` 지만 같은 AgentConfig 라
  // 옛 설정에 남아 있으면 그대로 산다
  it('deprecated 인 mode.*.model 도 모은다', () => {
    expect(providerIdsOf({ model: 'a/x', mode: { build: { model: 'b/y' } } })).toEqual(['a', 'b'])
  })

  it('여러 에이전트를 다 본다', () => {
    expect(
      providerIdsOf({ agent: { build: { model: 'a/x' }, plan: { model: 'b/y' } } }),
    ).toEqual(['a', 'b'])
  })

  it('같은 프로바이더가 여러 번 나와도 한 번만 준다', () => {
    expect(
      providerIdsOf({ model: 'a/x', small_model: 'a/y', agent: { build: { model: 'a/z' } } }),
    ).toEqual(['a'])
  })

  // **첫 `/` 에서만 자른다** — 마지막으로 자르면 `openrouter/anthropic` 이 되어 목록에 없고,
  // 조용히 「전부」로 물러난다. 틀렸는데 초록으로 보이는 모양이다.
  it('모델 id 에 / 가 들어가도 프로바이더만 가른다', () => {
    expect(providerIdsOf({ model: 'openrouter/anthropic/claude-3' })).toEqual(['openrouter'])
  })

  describe('못 고르는 것들 — 빈 배열이면 호출부가 「전부」로 물러난다', () => {
    it('아무것도 없을 때', () => {
      expect(providerIdsOf({})).toEqual([])
    })

    it('provider/model 모양이 아닐 때', () => {
      expect(providerIdsOf({ model: 'devstral' })).toEqual([])
    })

    it('슬래시로 시작하거나 끝날 때', () => {
      expect(providerIdsOf({ model: '/x', small_model: 'a/' })).toEqual([])
    })

    it('문자열이 아닌 값은 건너뛴다', () => {
      expect(providerIdsOf({ model: 42, small_model: null, agent: { build: {} } })).toEqual([])
    })

    // 못 고르는 것이 섞여 있어도 고를 수 있는 것은 살린다 — 하나 때문에 전부로 물러나지 않는다
    it('섞여 있으면 고를 수 있는 것만 준다', () => {
      expect(providerIdsOf({ model: 'devstral', small_model: 'b/y' })).toEqual(['b'])
    })
  })
})
