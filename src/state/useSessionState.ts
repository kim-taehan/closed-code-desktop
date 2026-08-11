import { useCallback, useEffect, useState } from 'react'
import { applyTurnEvent, EMPTY_SLICE, type SessionSlice } from './sessionSlice'
import type { PermissionMode } from '../../shared/protocol/kinds'

// 프로젝트별 세션 상태를 모아 둔다.
//
// 화면은 활성 프로젝트 것만 그리지만, **비활성 프로젝트 것도 계속 쌓는다** —
// 탭을 옮겼다 돌아왔을 때 그동안의 대화가 남아 있어야 하고,
// 탭 배지도 그 상태를 근거로 삼는다 (설계 §5).

export type SessionSlices = Record<string, SessionSlice>

export interface SessionStateApi {
  slices: SessionSlices
  /** 활성 프로젝트의 상태. 아직 세션이 없으면 빈 상태를 준다. */
  active: SessionSlice
  setPermissionMode: (mode: PermissionMode) => void
  /** 답한 승인 하나를 큐에서 뺀다. 다음 대기 승인이 모달로 나온다. */
  resolveApproval: (requestId: string) => void
  /** 답한 질문·계획 하나를 큐에서 뺀다. 다음 대기 카드가 나온다. */
  resolveQuestion: (questionId: string) => void
  resolvePlan: (planId: string) => void
}

export function useSessionState(activeId: string | null): SessionStateApi {
  const [slices, setSlices] = useState<SessionSlices>({})

  const update = useCallback((projectId: string, patch: (slice: SessionSlice) => SessionSlice) => {
    setSlices((current) => ({
      ...current,
      [projectId]: patch(current[projectId] ?? EMPTY_SLICE),
    }))
  }, [])

  useEffect(() => {
    const offs = [
      window.davis.onSessionState((session, id) => update(id, (s) => ({ ...s, session }))),
      window.davis.onChatSnapshot((snapshot, id) => update(id, (s) => ({ ...s, snapshot }))),
      window.davis.onHistoryState((history, id) => update(id, (s) => ({ ...s, history }))),
      window.davis.onReviewState((reviews, id) => update(id, (s) => ({ ...s, reviews }))),
      window.davis.onPermissionMode(({ mode }, id) =>
        update(id, (s) => ({ ...s, permissionMode: mode })),
      ),
      window.davis.onWorkingDir((workingDir, id) => update(id, (s) => ({ ...s, workingDir }))),
      window.davis.onTurnEvent((event, id) => {
        // 창이 비활성일 때 턴이 끝나거나 **사용자 응답을 기다리면** OS 알림을 청한다
        // (실제 표시 여부는 설정이 정한다). 응답 대기는 내가 움직여야 풀리므로
        // 무엇을 기다리는지까지 알린다 — 질문·계획은 대화 내용을 싣지 않는다.
        if (!document.hasFocus()) {
          // **어느 프로젝트의 턴인지 함께 보낸다.** 안 보내면 main 이 "지금 활성인 프로젝트"
          // 이름을 붙여, 배경에서 끝난 작업에 엉뚱한 프로젝트 이름이 찍힌다 —
          // "어느 창을 봐야 하는지" 를 알리려던 목적과 정반대가 된다.
          if (event.type === 'turn_ended') window.davis.notifyTaskDone({ projectId: id })
          else if (event.type === 'approval_requested')
            window.davis.notifyTaskDone({
              kind: 'toolRequest',
              projectId: id,
              detail: event.displayName ?? event.toolName,
            })
          else if (event.type === 'question_requested')
            window.davis.notifyTaskDone({ kind: 'question', projectId: id })
          else if (event.type === 'plan_requested')
            window.davis.notifyTaskDone({ kind: 'plan', projectId: id })
        }
        update(id, (s) => applyTurnEvent(s, event))
      }),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [update])

  // 낙관적 갱신. runtime 이 확정하면 permission_mode_changed 로 덮인다.
  const setPermissionMode = useCallback(
    (mode: PermissionMode) => {
      if (activeId !== null) update(activeId, (s) => ({ ...s, permissionMode: mode }))
    },
    [activeId, update],
  )

  const resolveApproval = useCallback(
    (requestId: string) => {
      if (activeId !== null) {
        update(activeId, (s) => ({
          ...s,
          approvals: s.approvals.filter((request) => request.requestId !== requestId),
        }))
      }
    },
    [activeId, update],
  )

  const resolveQuestion = useCallback(
    (questionId: string) => {
      if (activeId !== null) {
        update(activeId, (s) => ({
          ...s,
          questions: s.questions.filter((request) => request.questionId !== questionId),
        }))
      }
    },
    [activeId, update],
  )

  const resolvePlan = useCallback(
    (planId: string) => {
      if (activeId !== null) {
        update(activeId, (s) => ({
          ...s,
          plans: s.plans.filter((request) => request.planId !== planId),
        }))
      }
    },
    [activeId, update],
  )

  return {
    slices,
    active: (activeId !== null ? slices[activeId] : undefined) ?? EMPTY_SLICE,
    setPermissionMode,
    resolveApproval,
    resolveQuestion,
    resolvePlan,
  }
}
