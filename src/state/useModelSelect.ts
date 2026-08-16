import { useCallback, useEffect, useState } from 'react'
import { EMPTY_LLM_MODEL_STATE, type LlmModelStatePayload } from '../../shared/protocol/llmConfig'

// 모델 스위처 상태 + 선택값 (DC-1322 미러).
//
// 선택값은 **렌더러 메모리뿐**이다 (영속 없음) — runtime 이 세션에 기억하지 않으므로
// 매 chat_request 에 다시 실어 보낸다. 앱을 끄면 사라지는 것은 그대로다.
//
// **다만 프로젝트를 옮겼다 돌아오면 남는다.** 예전에는 `[projectId, chatId]` 하나로
// 버렸고 근거가 *"대화가 바뀌면 기본으로"* 였는데, 프로젝트 전환이 곧 대화 전환이던
// 시절의 이야기다. **대화 이력을 되살린 뒤로 거짓이 됐다** (2026-08-16, 사용자 지적):
// 돌아오면 대화는 그대로인데 모델만 기본으로 돌아가, 같은 대화를 다른 모델로 잇게 된다.
// 그래서 프로젝트별로 나눠 든다 — 이력이 "돌아오면 그대로" 인 것과 짝을 맞춘다.

export interface ModelSelectApi {
  state: LlmModelStatePayload
  /** null = 기본 모델 (오버라이드 없음) */
  selected: string | null
  select: (model: string | null) => void
}

export function useModelSelect(projectId: string | null, chatId: string | null): ModelSelectApi {
  const [states, setStates] = useState<Record<string, LlmModelStatePayload>>({})
  /** 프로젝트별 오버라이드. 없는 키 = 기본 모델 */
  const [picks, setPicks] = useState<Record<string, string>>({})

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

  // **대화가 바뀔 때만** 기본으로 되돌린다 (리셋 → null, 이력 로드 → 새 chatId).
  // 이것이 runtime 무기억 계약과 짝인 부분이고, 프로젝트 전환은 여기 해당하지 않는다.
  useEffect(() => {
    if (projectId === null) return
    setPicks((current) => {
      if (!(projectId in current)) return current
      const next = { ...current }
      delete next[projectId]
      return next
    })
  }, [chatId])

  const state = (projectId !== null ? states[projectId] : undefined) ?? EMPTY_LLM_MODEL_STATE
  const selected = (projectId !== null ? picks[projectId] : undefined) ?? null

  // 선택지가 갱신됐는데 선택값이 목록 밖이면 버린다 (정책 변경·재조회 대비).
  // **이 프로젝트 것만 본다** — 남의 프로젝트 선택을 이쪽 목록으로 재면 멀쩡한 것이 버려진다.
  useEffect(() => {
    if (projectId === null) return
    setPicks((current) => {
      const pick = current[projectId]
      if (pick === undefined || state.options.includes(pick)) return current
      const next = { ...current }
      delete next[projectId]
      return next
    })
  }, [state.options, projectId])

  const select = useCallback(
    (model: string | null) => {
      if (projectId === null) return
      setPicks((current) => {
        if (model === null) {
          if (!(projectId in current)) return current
          const next = { ...current }
          delete next[projectId]
          return next
        }
        return { ...current, [projectId]: model }
      })
    },
    [projectId],
  )

  return { state, selected, select }
}
