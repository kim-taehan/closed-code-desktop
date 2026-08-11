import { useCallback, useEffect, useState } from 'react'
import { EMPTY_LLM_MODEL_STATE, type LlmModelStatePayload } from '../../shared/protocol/llmConfig'

// 모델 스위처 상태 + 선택값 (DC-1322 미러).
//
// 선택값은 **렌더러 메모리뿐**이다 (영속 없음) — runtime 이 세션에 기억하지 않으므로
// 매 chat_request 에 다시 실어 보내고, 대화가 바뀌면(전환·리셋) 기본으로 되돌린다.

export interface ModelSelectApi {
  state: LlmModelStatePayload
  /** null = 기본 모델 (오버라이드 없음) */
  selected: string | null
  select: (model: string | null) => void
}

export function useModelSelect(projectId: string | null, chatId: string | null): ModelSelectApi {
  const [states, setStates] = useState<Record<string, LlmModelStatePayload>>({})
  const [selected, setSelected] = useState<string | null>(null)

  // 상태는 프로젝트별로 온다 — 겉봉의 projectId 로 나눠 담는다
  useEffect(
    () =>
      window.davis.onModelState((payload, id) =>
        setStates((current) => ({ ...current, [id]: payload })),
      ),
    [],
  )

  // 프로젝트를 열거나 옮기면 최신 상태를 요청한다 (세션이 없으면 push 가 안 온다 — 그럼 숨김 유지)
  useEffect(() => {
    if (projectId !== null) void window.davis.requestModelOptions()
  }, [projectId])

  // 대화가 바뀌면(리셋 → null, 이력 로드 → 새 chatId) 선택을 기본으로 — runtime 무기억 계약과 짝
  useEffect(() => setSelected(null), [projectId, chatId])

  // 선택지가 갱신됐는데 선택값이 목록 밖이면 버린다 (정책 변경·재조회 대비)
  const state = (projectId !== null ? states[projectId] : undefined) ?? EMPTY_LLM_MODEL_STATE
  useEffect(() => {
    setSelected((current) => (current !== null && !state.options.includes(current) ? null : current))
  }, [state.options])

  const select = useCallback((model: string | null) => setSelected(model), [])
  return { state, selected, select }
}
