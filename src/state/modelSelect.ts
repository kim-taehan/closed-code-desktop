import type { LlmModelStatePayload } from '../../shared/protocol/llmConfig'

// 모델 스위처 표시·목록 규칙 (DC-1322 미러). 순수 판단만 — 상태는 useModelSelect 가 든다.
//
// **fail-closed**: 보여도 되는 근거가 있을 때만 보인다. personal 은 조회 가능성이 있고,
// project 는 관리자가 allowed_models 를 설정했을 때뿐이다. 그 외(미설정·미연결·오류)는 숨긴다.

export interface ModelMenuOption {
  /** null 은 별도 지정 없이 현재 설정 모델(기본)을 쓴다. */
  model: string | null
  label: string
}

/** vscode isModelSwitcherEligible 과 같은 판정. */
export function isModelSwitcherEligible(state: LlmModelStatePayload): boolean {
  const source = state.status?.source ?? null
  return source === 'personal' || (source === 'project' && (state.status?.allowedModels.length ?? 0) > 0)
}

/**
 * 메뉴 항목. 현재 설정 모델을 맨 앞에 두고 그 항목을 "기본"(model=null)으로 삼는다 —
 * 기본으로 돌아가는 길이 항상 목록 안에 있어야 한다 (vscode buildModelMenuOptions 동일).
 */
export function buildModelMenuOptions(options: string[], currentModel: string): ModelMenuOption[] {
  const models = currentModel
    ? [currentModel, ...options.filter((model) => model !== currentModel)]
    : options
  return models.map((model) => ({ model: model === currentModel ? null : model, label: model }))
}

/** 스위처 버튼에 보일 이름. 오버라이드가 없으면 현재 설정 모델. */
export function displayModel(selected: string | null, currentModel: string): string {
  return selected ?? (currentModel || '모델')
}
