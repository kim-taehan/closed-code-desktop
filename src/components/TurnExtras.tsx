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
 * 셸 결과를 대화에 넘긴다. 넘길 때 **한 줄을 덧붙일 수 있다.**
 *
 * 명령과 출력만 넘기면 모델은 사용자가 그걸 왜 보여주는지 모른다 — 고쳐 달라는 것인지,
 * 왜 이렇게 나오는지 묻는 것인지. 그래서 덧붙일 칸을 함께 둔다.
 *
 * **칸은 처음부터 떠 있다.** 버튼을 눌러야 칸이 열리게 만들었다가 되물렸다 (2026-08-24) —
 * 결과를 보고 물음이 떠오른 사람에게 "열기" 는 순전한 군더더기였고, 열리는 것을 모르면
 * 그냥 빈 채로 넘긴다. 다만 **초점은 가져가지 않는다**: 셸을 돌릴 때마다 이 칸이 여럿
 * 생기고, 늘 떠 있는 칸이 초점을 빼앗으면 아래쪽 입력창을 쓰던 손이 튄다.
 * 빈 채로 넘기면 예전과 똑같이 나간다 (덧붙일 말은 선택이다).
 */
export function AskAboutShell({
  shell,
  onAsk,
}: {
  shell: { command: string; output: string }
  onAsk?: (command: string, output: string, note?: string) => void
}) {
  const [asked, setAsked] = useState(false)
  const [note, setNote] = useState('')
  if (!onAsk) return null

  const send = () => {
    setAsked(true)
    const trimmed = note.trim()
    // 공백뿐인 덧말은 없는 것으로 친다 — 질문 없는 빈 줄이 프롬프트 끝에 붙지 않게
    onAsk(shell.command, shell.output, trimmed === '' ? undefined : trimmed)
  }

  // 한 번 넘긴 뒤에는 칸도 거둔다 — 두 번 넘길 수 있는 자리가 아니다
  if (asked) {
    return (
      <div className="cc-shell-ask">
        <button type="button" className="cc-shell-ask__button" disabled>
          넘겼습니다
        </button>
      </div>
    )
  }

  return (
    <div className="cc-shell-ask">
      <input
        type="text"
        className="cc-shell-ask__input"
        value={note}
        placeholder="덧붙일 말 (선택)"
        aria-label="덧붙일 말"
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          // 한글 조합 확정 Enter 도 keydown 으로 올라온다 (Composer.tsx:222 와 같은 자리) —
          // isComposing 을 안 보면 첫 글자를 확정하는 순간 넘어간다
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            send()
          } else if (event.key === 'Escape') {
            // 접을 칸이 없으니 Escape 는 쓰던 말을 지운다 — 넘기지는 않는다
            setNote('')
          }
        }}
      />
      <button
        type="button"
        className="cc-shell-ask__button"
        onClick={send}
        title="이 명령과 출력을 대화에 넘깁니다"
      >
        이 결과 물어보기
      </button>
      <span className="cc-shell-ask__note">지금은 화면에만 있어 모델이 보지 못합니다</span>
    </div>
  )
}

