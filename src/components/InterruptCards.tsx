import { useState } from 'react'
import { ApprovalModal, type ApprovalRequest } from './ApprovalModal'
import type { QuestionRequest, PlanRequest } from '../state/sessionSlice'
import { t } from '../i18n/messages'

// HIL 인터럽트 셋(도구 승인 · ask_user 질문 · 계획 승인)을 한곳에서 그린다.
//
// 셋 다 "답하지 않으면 턴이 멈춘다"는 같은 계약이라 한 파일에 모은다.
//
// 셋의 루트에 `data-interrupt` 를 단다. **여기에 카드를 더하면 그것도 달아야 한다** —
// Esc 의 임자 판정(`useShortcuts.ts` 의 `borrowed`)이 이 표식으로 "턴이 사용자를 기다리는
// 모달"과 그냥 떠 있는 모달을 가른다. 전자에서는 Esc 가 턴을 중단해야 하고, 후자에서는
// 중단하면 안 된다. 표식이 없으면 중단이 막혀 **턴을 접을 길이 아예 없어진다**
// (모달이 화면을 덮어 중단 버튼도 못 누른다).
// 도구 승인만 제한시간이 있다 (ApprovalModal 몫). 질문·계획은 사용자가 읽고
// 생각할 시간이 필요하므로 시계를 두지 않는다 — 대신 취소/거부가 항상 있다.
// 동시에 여러 개면 승인 → 질문 → 계획 순으로 하나씩 보인다.

export interface InterruptCardsProps {
  approvals: ApprovalRequest[]
  question: QuestionRequest | null
  plan: PlanRequest | null
  /** 답한 카드를 큐에서 뺀다 — useSessionState 의 resolve 셋. 다음 대기 카드가 나온다. */
  resolve: {
    resolveApproval: (requestId: string) => void
    resolveQuestion: (questionId: string) => void
    resolvePlan: (planId: string) => void
  }
}

export function InterruptCards({ approvals, question, plan, resolve }: InterruptCardsProps) {
  const approval = approvals[0] ?? null

  if (approval) {
    return (
      <ApprovalModal
        request={approval}
        pending={approvals.length}
        onRespond={(requestId, approved, followUp) => {
          void window.davis.respondApproval({ requestId, approved, ...(followUp ? { followUp } : {}) })
          resolve.resolveApproval(requestId)
        }}
      />
    )
  }

  if (question) {
    return (
      <QuestionCard
        request={question}
        onAnswer={(answer) => {
          void window.davis.respondQuestion({ questionId: question.questionId, answer })
          resolve.resolveQuestion(question.questionId)
        }}
      />
    )
  }

  if (plan) {
    return (
      <PlanCard
        request={plan}
        onRespond={(approved, comment) => {
          void window.davis.respondPlan({
            planId: plan.planId,
            approved,
            ...(comment ? { comment } : {}),
          })
          resolve.resolvePlan(plan.planId)
        }}
      />
    )
  }

  return null
}

/** ask_user 질문. 선택지가 있으면 버튼으로, 없으면 자유 입력으로 답한다. */
function QuestionCard({
  request,
  onAnswer,
}: {
  request: QuestionRequest
  onAnswer: (answer: string | null) => void
}) {
  const [text, setText] = useState('')

  return (
    <div className="dc-modal" role="dialog" data-interrupt aria-label={t('에이전트 질문')}>
      <div className="dc-modal__card interrupt-card" onClick={(event) => event.stopPropagation()}>
        <div className="dc-modal__head">
          <span className="dc-modal__title">{t('에이전트 질문')}</span>
        </div>

        <p className="interrupt-card__body">{request.question}</p>

        {request.options && request.options.length > 0 && (
          <div className="interrupt-card__options">
            {request.options.map((option) => (
              <button
                key={option}
                type="button"
                className="interrupt-card__option"
                onClick={() => onAnswer(option)}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        <textarea
          className="interrupt-card__input"
          placeholder={t('직접 입력…')}
          value={text}
          rows={2}
          autoFocus={!request.options?.length}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && text.trim()) {
              event.preventDefault()
              onAnswer(text.trim())
            }
          }}
        />

        <div className="approval-modal__actions">
          <button
            type="button"
            className="approval-allow"
            disabled={!text.trim()}
            onClick={() => onAnswer(text.trim())}
          >
            {t('답변 보내기')}
          </button>
          <button type="button" className="approval-deny" onClick={() => onAnswer(null)}>
            {t('취소')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** propose_plan 계획 카드. 승인하면 에이전트가 계획대로 실행에 들어간다. */
function PlanCard({
  request,
  onRespond,
}: {
  request: PlanRequest
  onRespond: (approved: boolean, comment?: string) => void
}) {
  const [comment, setComment] = useState('')
  const send = (approved: boolean) => onRespond(approved, comment.trim() || undefined)

  return (
    <div className="dc-modal" role="dialog" data-interrupt aria-label={t('계획 승인')}>
      <div className="dc-modal__card interrupt-card" onClick={(event) => event.stopPropagation()}>
        <div className="dc-modal__head">
          <span className="dc-modal__title">
            {t('계획 승인')}
            {request.estimatedSteps !== undefined ? ` · ${request.estimatedSteps}${t('단계')}` : ''}
          </span>
        </div>

        <p className="interrupt-card__body">{request.summary}</p>

        {request.filesToChange && request.filesToChange.length > 0 && (
          <div className="interrupt-card__files">
            <span className="approval-modal__label">{t('변경 파일')}</span>
            <ul>
              {request.filesToChange.map((file) => (
                <li key={file}>
                  <code>{file}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <textarea
          className="interrupt-card__input"
          placeholder={t('의견 (선택)…')}
          value={comment}
          rows={2}
          onChange={(event) => setComment(event.target.value)}
        />

        <div className="approval-modal__actions">
          <button type="button" className="approval-allow" autoFocus onClick={() => send(true)}>
            {t('계획 승인')}
          </button>
          <button type="button" className="approval-deny" onClick={() => send(false)}>
            {t('거부')}
          </button>
        </div>
      </div>
    </div>
  )
}
