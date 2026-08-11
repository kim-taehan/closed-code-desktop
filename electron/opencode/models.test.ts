import { describe, expect, it } from 'vitest'
import {
  listModels,
  modelName,
  resolveStatus,
  serverDefaultModel,
  statusPayload,
  toModelRef,
} from './models'
import { parseLlmStatus } from '../../shared/protocol/llmConfig'
import { isModelSwitcherEligible } from '../../src/state/modelSelect'

// 실측 응답 (opencode 1.17.18, `curl /config/providers`).
// **`{data:...}` 로 감싸지 않는다** — `/api` 가 아니기 때문이다.
const PROVIDERS = {
  providers: [
    { id: 'opencode', name: 'OpenCode Zen', models: { 'big-pickle': {}, 'mimo-v2.5-free': {} } },
    { id: 'ollama-local', name: 'Ollama (집/로컬)', models: { 'devstral:24b': {} } },
  ],
  default: { opencode: 'big-pickle', 'ollama-local': 'devstral:24b' },
}

describe('모델 이름 접기/펴기', () => {
  it('providerID/modelID 로 접는다', () => {
    expect(modelName({ providerID: 'ollama-local', id: 'devstral:24b' })).toBe('ollama-local/devstral:24b')
  })

  it('첫 / 에서만 자른다 — 모델 id 에 / 가 있어도 프로바이더를 잃지 않는다', () => {
    expect(toModelRef('gw/anthropic/claude-x')).toEqual({ providerID: 'gw', id: 'anthropic/claude-x' })
  })

  it('모델 id 의 : 는 건드리지 않는다 (ollama 태그)', () => {
    expect(toModelRef('ollama-local/devstral:24b')).toEqual({
      providerID: 'ollama-local',
      id: 'devstral:24b',
    })
  })

  it('모양이 아니면 null — 앞뒤가 비면 프로바이더도 모델도 아니다', () => {
    expect(toModelRef('devstral')).toBeNull()
    expect(toModelRef('/devstral')).toBeNull()
    expect(toModelRef('ollama-local/')).toBeNull()
  })
})

describe('프로바이더 목록 펼치기', () => {
  it('등록 순서대로 전부 편다', () => {
    expect(listModels(PROVIDERS)).toEqual([
      'opencode/big-pickle',
      'opencode/mimo-v2.5-free',
      'ollama-local/devstral:24b',
    ])
  })

  it('모델이 없는 프로바이더는 아무것도 내지 않는다', () => {
    expect(listModels({ providers: [{ id: 'empty' }] })).toEqual([])
  })
})

describe('davis llm_config_status 로 번역', () => {
  it('위층 파서가 그대로 읽는다 — 필드 이름이 계약이다', () => {
    const parsed = parseLlmStatus(statusPayload('ollama-local/devstral:24b', listModels(PROVIDERS)))

    expect(parsed?.source).toBe('project')
    expect(parsed?.model).toBe('ollama-local/devstral:24b')
    expect(parsed?.allowedModels).toHaveLength(3)
  })

  // 모델이 여럿이라는 사실만으로는 부족하다 — 스위처가 **뜨는** 조건까지 확인해야
  // "목록은 만들었는데 화면에 안 보인다" 를 잡는다 (fail-closed 규칙).
  it('모델이 있으면 스위처가 뜬다', () => {
    const status = parseLlmStatus(statusPayload('opencode/big-pickle', listModels(PROVIDERS)))
    expect(isModelSwitcherEligible({ status, options: [], loading: false, error: null })).toBe(true)
  })

  it('모델이 하나도 없으면 스위처는 숨는다 — 고를 것이 없다', () => {
    const status = parseLlmStatus(statusPayload('', []))
    expect(isModelSwitcherEligible({ status, options: [], loading: false, error: null })).toBe(false)
  })
})

// 모델 없이 세션을 만들면 응답에 model 이 없다(실측). 그 세션의 기본이 무엇인지는
// 서버 설정으로만 알 수 있고, 모르면 스위처에서 오버라이드를 풀 길이 사라진다.
describe('서버 기본 모델', () => {
  it('설정의 model 을 편다', async () => {
    const client = { config: () => Promise.resolve({ model: 'ollama-local/devstral:24b' }) }
    expect(await serverDefaultModel(client)).toEqual({ providerID: 'ollama-local', id: 'devstral:24b' })
  })

  it('설정에 없으면 null — 모르는 채로 아무 모델이나 밀지 않는다', async () => {
    expect(await serverDefaultModel({ config: () => Promise.resolve({}) })).toBeNull()
  })

  it('조회가 실패해도 던지지 않는다', async () => {
    const client = { config: () => Promise.reject(new Error('연결 거부')) }
    expect(await serverDefaultModel(client)).toBeNull()
  })
})

describe('목록 조회 실패', () => {
  it('던지지 않고 지금 쓰는 모델 하나만 남긴다 — 대화 화면에 실패를 띄우지 않는다', async () => {
    const client = { providers: () => Promise.reject(new Error('연결 거부')) }
    const data = await resolveStatus(client, { providerID: 'ollama-local', id: 'devstral:24b' })

    expect(parseLlmStatus(data)?.allowedModels).toEqual(['ollama-local/devstral:24b'])
  })

  it('쓰는 모델조차 모르면 빈 목록 — 스위처가 숨는다', async () => {
    const client = { providers: () => Promise.reject(new Error('연결 거부')) }
    const status = parseLlmStatus(await resolveStatus(client, null))

    expect(status?.allowedModels).toEqual([])
    expect(isModelSwitcherEligible({ status, options: [], loading: false, error: null })).toBe(false)
  })
})
