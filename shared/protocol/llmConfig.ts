// llm_config 계약의 desktop 쪽 해석 (DC-1322 미러, ADR-045).
// 출처: davis-code-runtime/src/app/websocket/domains/llm_config.py (dev, f7589d64)
//
// desktop 은 BYOK 설정(set/test)이 없다 — 모델 스위처가 쓰는 status/models 만 다룬다.

/** llm_config_status 응답에서 스위처 판단에 쓰는 부분. */
export interface LlmStatus {
  source: 'personal' | 'project' | null
  /** 지금 설정된 모델 (오버라이드 아님). 표시용. */
  model: string
  /** personal 일 때 모델 목록 조회에 필요하다. */
  providerType: string
  baseUrl: string
  /**
   * project 일 때만 유의미한 요청별 전환 허용 목록.
   * 빈 배열 = 오버라이드 불허 (fail-closed — runtime 판정과 동일 규칙).
   */
  allowedModels: string[]
}

/** main → renderer 로 미는 스위처 상태. 프로젝트(세션) 단위다. */
export interface LlmModelStatePayload {
  status: LlmStatus | null
  /** 고를 수 있는 모델. project=allowed_models, personal=엔드포인트 조회 결과. */
  options: string[]
  /** personal 모델 목록을 기다리는 중 */
  loading: boolean
  /** 조회 실패 사유. fail-closed 이므로 스위처는 숨는다. */
  error: string | null
}

export const EMPTY_LLM_MODEL_STATE: LlmModelStatePayload = {
  status: null,
  options: [],
  loading: false,
  error: null,
}

/** csv("a, b") 또는 배열을 모델 목록으로. 빈 항목은 버린다. */
export function csvToModels(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 신뢰할 수 없는 status 응답 data 를 좁힌다. 모양이 아니면 null. */
export function parseLlmStatus(raw: unknown): LlmStatus | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const source = record['source']
  return {
    source: source === 'personal' || source === 'project' ? source : null,
    model: typeof record['model'] === 'string' ? record['model'] : '',
    providerType: typeof record['provider_type'] === 'string' ? record['provider_type'] : '',
    baseUrl: typeof record['base_url'] === 'string' ? record['base_url'] : '',
    allowedModels: csvToModels(record['allowed_models']),
  }
}
