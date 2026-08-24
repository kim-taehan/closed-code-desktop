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


/**
 * 셸 결과를 대화에 넘긴다. 넘기기 전에 **한 줄을 덧붙일 수 있다.**
 *
 * 명령과 출력만 넘기면 모델은 사용자가 그걸 왜 보여주는지 모른다 — 고쳐 달라는 것인지,
 * 왜 이렇게 나오는지 묻는 것인지. 그래서 클릭이 곧 전송이 아니라 **입력 한 칸을 연다.**
 * 빈 채로 보내면 예전과 똑같이 나간다 (덧붙일 말은 선택이다).
 */
export function AskAboutShell({
  shell,
  onAsk,
}: {
  shell: { command: string; output: string }
  onAsk?: (command: string, output: string, note?: string) => void
}) {
  const [asked, setAsked] = useState(false)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  if (!onAsk) return null

  const send = () => {
    setAsked(true)
    setOpen(false)
    const trimmed = note.trim()
    // 공백뿐인 덧말은 없는 것으로 친다 — 질문 없는 빈 줄이 프롬프트 끝에 붙지 않게
    onAsk(shell.command, shell.output, trimmed === '' ? undefined : trimmed)
  }

  if (open) {
    return (
      <div className="cc-shell-ask">
        <input
          type="text"
          className="cc-shell-ask__input"
          value={note}
          placeholder="덧붙일 말 (선택)"
          aria-label="덧붙일 말"
          autoFocus
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            // 한글 조합 확정 Enter 도 keydown 으로 올라온다 (Composer.tsx:222 와 같은 자리) —
            // isComposing 을 안 보면 첫 글자를 확정하는 순간 전송된다
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            } else if (event.key === 'Escape') {
              // 나가는 길. 쓰던 덧말은 버린다 — 다음에 열면 빈 칸이 맞다
              setOpen(false)
              setNote('')
            }
          }}
        />
        <button type="button" className="cc-shell-ask__button" onClick={send}>
          보내기
        </button>
      </div>
    )
  }

  return (
    <div className="cc-shell-ask">
      <button
        type="button"
        className="cc-shell-ask__button"
        disabled={asked}
        onClick={() => setOpen(true)}
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

