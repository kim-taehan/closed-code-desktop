// @vitest-environment jsdom
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { focusIsClaimed, useComposerFocus } from './composerFocus'

// 커서를 대화 입력창으로 옮기는 판정.
//
// 겨누는 것은 "잡는가" 가 아니라 **"언제 물러나는가"** 다. 뺏으면 안 되는 자리는
// 전부 실측으로 뽑았다 (`.focus()`·`autoFocus` 호출부 전수) — 셸(xterm)·인터럽트 카드·
// 검색·빠른 열기·확장 입력·소스관리 이름칸.

// **`cleanup()` 은 RTL 이 그린 것만 치운다.** 아래 `claimFocus` 가 손으로 붙인 마디는
// 남고, 그중 `role="listbox"` 하나가 `OVERLAY` 에 걸려 **다음 describe 를 통째로 오염시켰다**
// — 임자가 있다고 읽혀 훅이 물러나고, 「잡는다」 셋이 전부 빨개졌다. 더 나쁜 것은 같은 블록의
// 「물러난다」가 **그 오염 덕분에 초록이었다**는 점이다 (겨누던 셸 textarea 없이도 통과).
// 그래서 붙인 것을 여기서 되돌린다.
const claimed: HTMLElement[] = []

afterEach(() => {
  cleanup()
  claimed.splice(0).forEach((host) => host.remove())
})

function Host({ focusKey }: { focusKey: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useComposerFocus(ref, focusKey)
  return <textarea ref={ref} data-testid="composer" />
}

/** 화면에 마디를 붙인다. **붙인 것은 반드시 여기를 거친다** — 위 afterEach 가 그것만 치운다 */
function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  claimed.push(host)
  return host.firstElementChild as HTMLElement
}

/** 다른 곳이 포커스를 쥔 상태를 만든다 */
function claimFocus(html: string): HTMLElement {
  const target = mount(html)
  target.focus()
  return target
}

describe('임자 판정', () => {
  it('아무도 안 잡고 있으면 임자가 없다', () => {
    expect(focusIsClaimed()).toBe(false)
  })

  it('셸에 치고 있으면 임자다 — 뺏으면 글자가 입력창으로 샌다', () => {
    // xterm 은 textarea.xterm-helper-textarea 로 키를 받는다
    claimFocus('<textarea class="xterm-helper-textarea"></textarea>')
    expect(focusIsClaimed()).toBe(true)
  })

  it('빠른 열기·검색칸도 임자다', () => {
    claimFocus('<input type="text" />')
    expect(focusIsClaimed()).toBe(true)
  })

  // ⚠️ 여기가 `useShortcuts` 의 `borrowed()` 와 **답이 갈리는 자리**다.
  // 저쪽은 이 카드를 일부러 제외한다(제외 안 하면 Esc 로 턴을 접을 길이 없어진다).
  // 포커스는 반대다 — 「허용」의 autoFocus 를 뺏으면 Enter 승인이 그 자리에서 깨진다.
  it('승인 카드는 임자다 — Esc 판정에서 제외된 것과 반대다', () => {
    mount('<div role="dialog" data-interrupt><button>허용</button></div>')
    expect(focusIsClaimed()).toBe(true)
  })

  it('덮고 있는 모달·드롭다운도 임자다 (포커스가 어디 있든)', () => {
    mount('<div role="listbox"></div>')
    expect(focusIsClaimed()).toBe(true)
  })
})

describe('입력창이 커서를 가져오는 순간', () => {
  it('프로젝트가 바뀌면 잡는다', () => {
    const { getByTestId, rerender } = render(<Host focusKey="p1:chat" />)
    const composer = getByTestId('composer')
    // 다른 버튼이 쥐고 있어도 — 버튼은 임자가 아니다 (프로젝트 탭을 누른 직후가 그렇다)
    claimFocus('<button>프로젝트 B</button>')
    expect(document.activeElement).not.toBe(composer)

    rerender(<Host focusKey="p2:chat" />)
    expect(document.activeElement).toBe(composer)
  })

  it('탭이 바뀌어도 잡는다', () => {
    const { getByTestId, rerender } = render(<Host focusKey="p1:chat" />)
    claimFocus('<button>파일</button>')
    rerender(<Host focusKey="p1:src/main.ts" />)
    expect(document.activeElement).toBe(getByTestId('composer'))
  })

  it('임자가 있으면 프로젝트가 바뀌어도 물러난다', () => {
    const { getByTestId, rerender } = render(<Host focusKey="p1:chat" />)
    const shell = claimFocus('<textarea class="xterm-helper-textarea"></textarea>')

    rerender(<Host focusKey="p2:chat" />)
    expect(document.activeElement).toBe(shell)
    expect(document.activeElement).not.toBe(getByTestId('composer'))
  })

  it('창이 돌아왔을 때 — 원래 자리가 살아 있으면 그대로 둔다', () => {
    const { getByTestId } = render(<Host focusKey="p1:chat" />)
    const shell = claimFocus('<textarea class="xterm-helper-textarea"></textarea>')

    fireEvent.focus(window)
    expect(document.activeElement).toBe(shell)
    expect(document.activeElement).not.toBe(getByTestId('composer'))
  })

  it('창이 돌아왔는데 아무도 안 잡고 있으면 입력창이 받는다', () => {
    const { getByTestId } = render(<Host focusKey="p1:chat" />)
    ;(document.activeElement as HTMLElement | null)?.blur()

    fireEvent.focus(window)
    expect(document.activeElement).toBe(getByTestId('composer'))
  })
})
