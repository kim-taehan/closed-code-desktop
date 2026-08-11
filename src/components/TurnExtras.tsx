import { useState } from 'react'
import { TokenUsage } from './TokenUsage'
import type { TurnMeta } from '../../shared/ipc/messageTypes'

// 턴에 딸리는 작은 것들 — 발치(토큰·피드백)와 셸 결과 넘기기.
// MessageList 가 300줄을 넘어 갈라냈다.

/**
 * 턴 발치 — 토큰 사용량과 피드백. 답이 끝난 뒤에만 나온다.
 *
 * 대답과 **구분선으로 나누고 우측에 붙인다.** 답변 본문이 아니라 그 답에 대한
 * 메타(얼마나 썼나·평가하기)라서, 흐름에 섞이지 않고 발치에 물러나 있어야 한다.
 */
export function TurnFooter({
  tokens,
  onFeedback,
}: {
  tokens: TurnMeta['tokens']
  onFeedback?: () => void
}) {
  return (
    <div className="cc-turn-footer">
      <TokenUsage tokens={tokens} />
      {/* 오는 중에 평가할 수는 없다 */}
      {onFeedback && (
        <button
          type="button"
          className="cc-feedback-icon"
          onClick={onFeedback}
          title="이 답변에 대해 피드백 보내기"
          aria-label="피드백 보내기"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}


export function AskAboutShell({
  shell,
  onAsk,
}: {
  shell: { command: string; output: string }
  onAsk?: (command: string, output: string) => void
}) {
  const [asked, setAsked] = useState(false)
  if (!onAsk) return null

  return (
    <div className="cc-shell-ask">
      <button
        type="button"
        className="cc-shell-ask__button"
        disabled={asked}
        onClick={() => {
          setAsked(true)
          onAsk(shell.command, shell.output)
        }}
        title="이 명령과 출력을 대화에 넘깁니다"
      >
        {asked ? '넘겼습니다' : '이 결과 물어보기'}
      </button>
      <span className="cc-shell-ask__note">
        {asked ? '' : '지금은 화면에만 있어 모델이 보지 못합니다'}
      </span>
    </div>
  )
}

