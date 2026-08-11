import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectAndHandshake, type SessionFixture } from '../../tests/fake-runtime/chatSessionKit'
import { LlmConfigController } from './llmConfig'
import type { LlmModelStatePayload } from '../../shared/protocol/llmConfig'

// llm_config status/models 왕복 (DC-1322 미러). fake-runtime 으로 WS 계약 전체를 재생한다.
// 핵심: project 는 allowed_models 가 곧 선택지(빈 값 fail-closed), personal 은 models 를
// ack replyTo 로 짝지어 라이브 조회하며, 실패·무응답은 error 로 표면화된다.

let fixture: SessionFixture | null = null
let controller: LlmConfigController | null = null

afterEach(async () => {
  controller?.stop()
  controller = null
  await fixture?.dispose()
  fixture = null
})

async function startController(): Promise<{ states: LlmModelStatePayload[] }> {
  fixture = await connectAndHandshake({})
  controller = new LlmConfigController(fixture.connection)
  const states: LlmModelStatePayload[] = []
  controller.onChange((state) => states.push(state))
  controller.start()
  return { states }
}

/** desktop 이 보낸 마지막 llm_config 요청 (reqId 를 응답 replyTo 로 되돌려야 한다) */
function lastLlmRequest() {
  const frames = fixture!.server.received.filter((frame) => frame.kind === 'llm_config')
  return frames[frames.length - 1]!
}

describe('llm_config — 모델 스위처 상태', () => {
  it('project 소스는 allowed_models(csv)가 곧 선택지다', async () => {
    const { states } = await startController()
    controller!.requestModelOptions()
    await vi.waitFor(() => expect(lastLlmRequest().action).toBe('llm_config_status'))

    fixture!.server.push([
      {
        kind: 'llm_config',
        action: 'llm_config_status',
        data: { source: 'project', model: 'qwen-122b', allowed_models: 'qwen-122b, glm-5, ' },
      } as never,
    ])

    await vi.waitFor(() => expect(states.length).toBe(1))
    expect(states[0]).toEqual({
      status: {
        source: 'project',
        model: 'qwen-122b',
        providerType: '',
        baseUrl: '',
        allowedModels: ['qwen-122b', 'glm-5'],
      },
      options: ['qwen-122b', 'glm-5'],
      loading: false,
      error: null,
    })
  })

  it('project 인데 allowed_models 가 비면 선택지도 빈다 (fail-closed — 스위처 숨김 근거)', async () => {
    const { states } = await startController()
    controller!.requestModelOptions()
    await vi.waitFor(() => expect(lastLlmRequest().action).toBe('llm_config_status'))

    fixture!.server.push([
      { kind: 'llm_config', action: 'llm_config_status', data: { source: 'project', model: 'm', allowed_models: '' } } as never,
    ])

    await vi.waitFor(() => expect(states.length).toBe(1))
    expect(states[0]!.options).toEqual([])
    expect(states[0]!.error).toBeNull()
  })

  it('personal 소스는 llm_config_models 를 이어 보내고 ack(replyTo)로 목록을 받는다', async () => {
    const { states } = await startController()
    controller!.requestModelOptions()
    await vi.waitFor(() => expect(lastLlmRequest().action).toBe('llm_config_status'))

    fixture!.server.push([
      {
        kind: 'llm_config',
        action: 'llm_config_status',
        data: { source: 'personal', model: 'gpt-x', provider_type: 'openai', base_url: 'http://llm:8080/v1' },
      } as never,
    ])

    // loading 상태를 먼저 알리고, models 요청이 나갔는지 계약대로 확인
    await vi.waitFor(() => expect(lastLlmRequest().action).toBe('llm_config_models'))
    expect(states[0]!.loading).toBe(true)
    const request = lastLlmRequest()
    expect(request.data).toMatchObject({ provider_type: 'openai', base_url: 'http://llm:8080/v1' })

    fixture!.server.push([
      { kind: 'llm_config', action: 'ack', replyTo: request.reqId, data: { models: ['gpt-x', 'gpt-y'] } } as never,
    ])

    await vi.waitFor(() => expect(states.length).toBe(2))
    expect(states[1]).toMatchObject({ options: ['gpt-x', 'gpt-y'], loading: false, error: null })
  })

  it('models 가 error 로 오면 사유를 표면화한다 (silent 처리 금지)', async () => {
    const { states } = await startController()
    controller!.requestModelOptions()
    await vi.waitFor(() => expect(lastLlmRequest().action).toBe('llm_config_status'))
    fixture!.server.push([
      { kind: 'llm_config', action: 'llm_config_status', data: { source: 'personal', provider_type: 'openai', base_url: 'http://x' } } as never,
    ])
    await vi.waitFor(() => expect(lastLlmRequest().action).toBe('llm_config_models'))

    fixture!.server.push([
      {
        kind: 'llm_config',
        action: 'error',
        replyTo: lastLlmRequest().reqId,
        data: { message: '모델 목록 조회 실패: HTTP 401. endpoint와 API 키를 확인하세요.' },
      } as never,
    ])

    await vi.waitFor(() => expect(states.length).toBe(2))
    expect(states[1]!.error).toContain('HTTP 401')
    expect(states[1]!.options).toEqual([])
  })

  it('models 응답이 없으면 타임아웃으로 error 를 낸다 (loading 잔류 방지)', async () => {
    // 타임아웃은 setTimeout 이 fake 타이머 아래에서 걸려야 감을 수 있다 —
    // WS 왕복 대신 가짜 Transport 로 status 수신 시점을 직접 통제한다.
    vi.useFakeTimers()
    try {
      let deliver: ((raw: string) => void) | null = null
      const transport = {
        isOpen: true,
        send: () => true,
        onOpen: () => () => {},
        onMessage: (handler: (raw: string) => void) => {
          deliver = handler
          return () => {}
        },
        onClose: () => () => {},
        onError: () => () => {},
      }
      const local = new LlmConfigController(transport as never)
      const states: LlmModelStatePayload[] = []
      local.onChange((state) => states.push(state))
      local.start()
      local.requestModelOptions()
      deliver!(
        JSON.stringify({
          kind: 'llm_config',
          action: 'llm_config_status',
          data: { source: 'personal', provider_type: 'openai', base_url: 'http://x' },
        }),
      )
      expect(states[states.length - 1]).toMatchObject({ loading: true })

      await vi.advanceTimersByTimeAsync(10_000)
      expect(states[states.length - 1]).toMatchObject({ loading: false, error: '모델 목록 응답 시간 초과' })
      local.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
