import { useEffect, useState } from 'react'
import type { ApprovalFollowUp } from '../../shared/ipc/channels'
import { buildToolChipLabel } from '../utils/buildToolDesc'
import { t } from '../i18n/messages'

// 도구 실행 승인 모달 (VS Code ApprovalModal 대응).
//
// 응답하지 않으면 턴이 그 자리에서 멈춘다 — 그래서 닫을 방법이 없고 허용/거부만 있다.
// 제한시간은 **클라이언트 몫**이다 (런타임은 그냥 기다린다). 넘기면 자동 거부한다.

const TIMEOUT_SECONDS = 15

/** 라디오 값 → 런타임 followUp. 이번만은 아무것도 안 보낸다. */
type Scope = 'none' | 'session' | 'local'
const FOLLOW_UP: Record<Scope, ApprovalFollowUp | undefined> = {
  none: undefined,
  session: 'session_allow',
  local: 'local_allow',
}
const SCOPES: Array<{ value: Scope; label: string }> = [
  { value: 'none', label: '이번만 허용' },
  { value: 'session', label: '이 세션 동안 자동 승인' },
  { value: 'local', label: '이 PC에서 항상 허용' },
]

export interface ApprovalRequest {
  requestId: string
  toolName: string
  args?: unknown
  reason?: string
  displayName?: string
}

export interface ApprovalModalProps {
  request: ApprovalRequest
  onRespond: (requestId: string, approved: boolean, followUp?: ApprovalFollowUp) => void
  /** 큐에 쌓인 승인 총 개수 (현재 것 포함). 2 이상이면 몇 건 더 남았는지 알린다. */
  pending?: number
}

export function ApprovalModal({ request, onRespond, pending = 1 }: ApprovalModalProps) {
  const [scope, setScope] = useState<Scope>('none')
  const [showArgs, setShowArgs] = useState(false)
  const [remaining, setRemaining] = useState(TIMEOUT_SECONDS)

  // 넘기면 자동 거부 — 런타임은 응답을 무한정 기다리므로 여기서 끝내야 턴이 풀린다.
  // 요청이 바뀌면 시계를 다시 맞춘다.
  useEffect(() => {
    setScope('none')
    setRemaining(TIMEOUT_SECONDS)
    const started = Date.now()
    const timer = setInterval(() => {
      const left = TIMEOUT_SECONDS - Math.floor((Date.now() - started) / 1000)
      if (left <= 0) {
        clearInterval(timer)
        onRespond(request.requestId, false)
      } else {
        setRemaining(left)
      }
    }, 250)
    return () => clearInterval(timer)
  }, [request.requestId, onRespond])

  const chip = buildToolChipLabel(request.toolName, request.args)

  return (
    <div className="dc-modal" role="dialog" data-interrupt aria-label={t('도구 실행 승인')}>
      <div className="dc-modal__card approval-modal" onClick={(event) => event.stopPropagation()}>
        <div className="dc-modal__head">
          <span className="dc-modal__title">
            {t('도구 실행 승인')} ({remaining}s)
            {pending > 1 ? ` · ${t('외')} ${pending - 1}${t('건 대기')}` : ''}
          </span>
        </div>

        <div className="approval-modal__field">
          <span className="approval-modal__label">{t('도구')}</span>
          <strong className="approval-modal__value">{request.displayName ?? request.toolName}</strong>
        </div>

        {(request.reason || chip) && (
          <div className="approval-modal__field">
            <span className="approval-modal__label">{t('사유')}</span>
            <span className="approval-modal__value">{request.reason ?? chip}</span>
          </div>
        )}

        {request.args !== undefined && request.args !== null && (
          <div className="approval-modal__args">
            <button
              type="button"
              className="approval-card-toggle"
              onClick={() => setShowArgs((previous) => !previous)}
            >
              {showArgs ? `▲ ${t('인자 숨기기')}` : `▼ ${t('인자 보기')}`}
            </button>
            {showArgs && <pre className="approval-card-args">{formatArgs(request.args)}</pre>}
          </div>
        )}

        <ul className="approval-modal__scopes">
          {SCOPES.map((option) => (
            <li key={option.value}>
              <label className="approval-modal__scope">
                <input
                  type="radio"
                  name="approval-scope"
                  checked={scope === option.value}
                  onChange={() => setScope(option.value)}
                />
                {t(option.label)}
              </label>
            </li>
          ))}
        </ul>

        <div className="approval-modal__actions">
          <button
            type="button"
            className="approval-allow"
            onClick={() => onRespond(request.requestId, true, FOLLOW_UP[scope])}
            autoFocus
          >
            {t('승인')}
          </button>
          <button
            type="button"
            className="approval-deny"
            onClick={() => onRespond(request.requestId, false)}
          >
            {t('거부')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 인자를 읽기 좋게. JSON 으로 구조를 보이되 문자열 안의 줄바꿈은 실제 줄로 편다 —
 * 안 그러면 긴 설명이 `\n\n` 리터럴로 나와 읽기 어렵다. 판단용 미리보기라 유효 JSON 은 아니어도 된다.
 */
function formatArgs(args: unknown): string {
  const text = typeof args === 'string' ? args : JSON.stringify(args, null, 2).replace(/\\n/g, '\n')
  return text.length > 2_000 ? `${text.slice(0, 2_000)}\n… (생략)` : text
}
