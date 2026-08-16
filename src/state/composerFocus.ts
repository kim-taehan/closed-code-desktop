import { useEffect, type RefObject } from 'react'

// 커서를 대화 입력창으로 옮기는 판정.
//
// 규칙 셋 (사용자 결정):
//   · 프로젝트를 열거나 탭을 바꿀 때 → 입력창. 그 순간엔 대개 임자가 없다
//   · 창이 다시 포커스를 받을 때     → 원래 있던 자리로. 셸에 있었으면 셸로
//   · **잡을 임자가 있으면 건드리지 않는다** — 위 둘을 덮는 규칙이다
//
// ⚠️ **`useShortcuts` 의 `borrowed()` 와 같은 질문이 아니다.** 저쪽은 "이 Esc 는 누구
// 것인가", 여기는 "지금 포커스를 뺏어도 되는가" 다. 답이 갈리는 자리가 실제로 있다:
// **HIL 인터럽트 카드(승인·질문·계획)** 는 저쪽에서 일부러 제외되지만(`data-interrupt` —
// 그걸 임자로 치면 턴을 접을 길이 없어진다) 여기서는 **임자다.** 「허용」 버튼이
// `autoFocus` 로 잡은 것을 뺏으면 Enter 로 승인하는 흐름이 그 자리에서 깨진다
// (`InterruptCards.tsx:117,190`). 그래서 판정을 공유하지 않고 따로 둔다.

/** 화면을 덮고 있는 것. 그 안에 임자가 있다고 본다 — 인터럽트 카드도 뺀 것 없이 포함한다. */
const OVERLAY = '[role="dialog"],[role="menu"],[role="listbox"]'

/**
 * 글을 받고 있는 자리.
 *
 * 셸(xterm)은 `textarea.xterm-helper-textarea` 로 키를 받으므로 여기 걸린다 —
 * 뺏으면 **셸에 치던 글자가 대화 입력창으로 샌다** (`DrawerTerminal.tsx`).
 * 우리 입력창도 `textarea` 라 함께 걸리는데, 그때는 이미 우리 것이라 건너뛰어도 같다.
 */
const TYPING = 'input,textarea,[contenteditable="true"]'

/** 지금 이 포커스에 임자가 있는가. 있으면 우리는 물러난다. */
export function focusIsClaimed(): boolean {
  if (document.querySelector(OVERLAY) !== null) return true
  const active = document.activeElement
  if (active === null || active === document.body) return false
  return active.matches(TYPING)
}

/**
 * 대화 입력창이 커서를 가져오는 두 순간.
 *
 * `key` 는 값이 아니라 **바뀌었다는 신호**로만 쓴다 (프로젝트 id + 보고 있는 탭).
 * 창 복귀는 브라우저가 원래 요소를 되살려 주므로 **아무도 못 잡았을 때만** 우리가 잡는다 —
 * 그래야 "셸에 있었으면 셸로" 가 저절로 성립한다.
 */
export function useComposerFocus(ref: RefObject<HTMLTextAreaElement | null>, key: string): void {
  useEffect(() => {
    if (!focusIsClaimed()) ref.current?.focus()
  }, [key])

  useEffect(() => {
    const onWindowFocus = (): void => {
      if (!focusIsClaimed()) ref.current?.focus()
    }
    window.addEventListener('focus', onWindowFocus)
    return () => window.removeEventListener('focus', onWindowFocus)
  }, [])
}
