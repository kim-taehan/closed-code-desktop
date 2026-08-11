import { createEnvelope, parseInbound, serializeEnvelope } from '../../shared/protocol/envelope'
import { Action, Kind } from '../../shared/protocol/kinds'
import {
  EMPTY_LLM_MODEL_STATE,
  csvToModels,
  parseLlmStatus,
  type LlmModelStatePayload,
  type LlmStatus,
} from '../../shared/protocol/llmConfig'
import { HandlerSet, type Transport, type Unsubscribe } from '../ws/transport'

// 모델 스위처의 상태 공급자 (kind=llm_config, DC-1322 미러).
//
// 두 단계다: status 로 personal/project 를 가르고,
//   - project  → allowed_models(csv) 가 곧 선택지 (빈 값 = fail-closed 숨김)
//   - personal → llm_config_models 로 엔드포인트 목록을 **라이브 조회** (ack replyTo 대기)
// vscode 와 같이 조회에는 타임아웃을 둔다 — 응답이 안 오면 loading 이 영영 남는다.

/** 모델 목록 ack 대기 한도. vscode CHECK_TIMEOUT 와 같은 10초. */
const MODELS_TIMEOUT_MS = 10_000

export class LlmConfigController {
  private state: LlmModelStatePayload = EMPTY_LLM_MODEL_STATE
  private unsubscribe: Unsubscribe | null = null
  private readonly handlers = new HandlerSet<[LlmModelStatePayload]>()
  /** 대기 중인 models 요청. replyTo 로 응답을 짝짓는다. */
  private modelsReqId: string | null = null
  private modelsTimer: NodeJS.Timeout | null = null

  constructor(private readonly transport: Transport) {}

  get current(): LlmModelStatePayload {
    return this.state
  }

  start(): void {
    this.unsubscribe = this.transport.onMessage((raw) => this.handle(raw))
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.clearModelsWait()
    this.handlers.clear()
  }

  onChange(handler: (state: LlmModelStatePayload) => void): Unsubscribe {
    return this.handlers.add(handler)
  }

  /** 스위처 상태를 새로 받아온다. status → (personal 이면) models 순서로 이어진다. */
  requestModelOptions(): boolean {
    this.clearModelsWait()
    const envelope = createEnvelope(Kind.LLM_CONFIG, Action.LLM_CONFIG_STATUS, {})
    return this.transport.send(serializeEnvelope(envelope))
  }

  private handle(raw: string): void {
    const frame = parseInbound(raw)
    if (frame === null || frame.kind !== Kind.LLM_CONFIG) return

    if (frame.action === Action.LLM_CONFIG_STATUS) {
      this.onStatus(parseLlmStatus(frame.data))
      return
    }
    // models 응답은 ack(성공) 또는 error(실패)로, replyTo 로만 짝지을 수 있다
    if (this.modelsReqId !== null && frame.replyTo === this.modelsReqId) {
      this.clearModelsWait()
      if (frame.action === Action.ACK) {
        const models = csvToModels((frame.data as Record<string, unknown> | undefined)?.['models'])
        this.emit({
          ...this.state,
          options: models,
          loading: false,
          error: models.length === 0 ? '사용 가능한 모델이 없습니다' : null,
        })
      } else {
        const message = (frame.data as Record<string, unknown> | undefined)?.['message']
        this.emit({
          ...this.state,
          options: [],
          loading: false,
          error: typeof message === 'string' && message ? message : '모델 목록을 불러오지 못했습니다',
        })
      }
    }
  }

  private onStatus(status: LlmStatus | null): void {
    if (status === null || status.source === null) {
      this.emit({ status, options: [], loading: false, error: null })
      return
    }
    if (status.source === 'project') {
      // 허용 목록이 곧 선택지다. 빈 값이면 스위처가 숨는다 (fail-closed)
      this.emit({ status, options: status.allowedModels, loading: false, error: null })
      return
    }
    // personal — 엔드포인트에 모델 목록을 물어본다. desktop 은 BYOK 저장소가 없어
    // api_key 를 싣지 못한다 — 키가 필요한 엔드포인트면 runtime 이 명시 에러를 준다.
    this.emit({ status, options: [], loading: true, error: null })
    const envelope = createEnvelope(Kind.LLM_CONFIG, Action.LLM_CONFIG_MODELS, {
      provider_type: status.providerType,
      base_url: status.baseUrl,
      api_key: '',
    })
    this.modelsReqId = envelope.reqId
    if (!this.transport.send(serializeEnvelope(envelope))) {
      this.modelsReqId = null
      this.emit({ ...this.state, loading: false, error: '연결이 없어 모델 목록을 조회하지 못했습니다' })
      return
    }
    this.modelsTimer = setTimeout(() => {
      this.modelsReqId = null
      this.modelsTimer = null
      this.emit({ ...this.state, loading: false, error: '모델 목록 응답 시간 초과' })
    }, MODELS_TIMEOUT_MS)
  }

  private clearModelsWait(): void {
    if (this.modelsTimer) clearTimeout(this.modelsTimer)
    this.modelsTimer = null
    this.modelsReqId = null
  }

  private emit(state: LlmModelStatePayload): void {
    this.state = state
    this.handlers.emit(state)
  }
}
