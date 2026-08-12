// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useShortcuts, type ShortcutContext, type ShortcutHandlers } from './useShortcuts'

// 턴 UX 키 — Esc(응답 중단)와 ⌘Enter(리뷰 적용)가 **무엇을 하는가**.
// 수식키 단축키(useShortcuts.test.tsx)와 갈라 둔다: 이쪽은 **캡처 단계**라
// 전파를 끊는지까지 봐야 해서 단언의 결이 다르다.
// 누가 이 키의 임자인가는 useShortcuts.owners.test.tsx 가 본다.
// onLogs 는 뺀다 — 개발자 모드에서만 넘어오는 선택 핸들러라 평상시 handlers 에 없다
function makeHandlers(): ShortcutHandlers &
  Record<Exclude<keyof ShortcutHandlers, 'onLogs'>, ReturnType<typeof vi.fn>> {
  return {
    onQuickOpen: vi.fn(),
    onSearch: vi.fn(),
    onNewChat: vi.fn(),
    onSettings: vi.fn(),
    onCloseTab: vi.fn(),
    onNextTab: vi.fn(),
    onPrevTab: vi.fn(),
    onNextProject: vi.fn(),
    onPrevProject: vi.fn(),
    onProjectAt: vi.fn(),
    onShellDown: vi.fn(),
    onShellUp: vi.fn(),
    onCancelTurn: vi.fn(),
    onAcceptReview: vi.fn(),
  }
}

/** 아무것도 안 도는 평상시 — Esc 는 임자가 없다 */
const IDLE: ShortcutContext = { streaming: false, canAcceptReview: false }

function mount(context: ShortcutContext = IDLE, enabled = true) {
  return renderHook(() => useShortcuts(handlers, enabled, context))
}

/** window 에 keydown 을 흘리고, 기본동작이 막혔는지 함께 돌려준다 */
function press(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { cancelable: true, ...init })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

/** 특정 요소에서 눌렀을 때 — bubbles 로 window 리스너까지 올려 보낸다 */
function pressOn(target: EventTarget, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

/**
 * 입력창에서 누른 키가 **입력창까지 닿았는지** 함께 돌려준다.
 *
 * 닿았다 = 우리가 안 먹었다 = 두 번 눌러 비우기(Composer)·전송이 그대로 산다.
 * 안 닿았다 = 우리가 캡처에서 먹고 전파를 끊었다.
 */
function pressInBox(init: KeyboardEventInit): { reached: boolean; prevented: boolean } {
  const box = document.createElement('textarea')
  document.body.appendChild(box)
  let reached = false
  box.addEventListener('keydown', () => {
    reached = true
  })
  const prevented = pressOn(box, init)
  box.remove()
  return { reached, prevented }
}

let handlers: ReturnType<typeof makeHandlers>
beforeEach(() => {
  handlers = makeHandlers()
})
// 안 치우면 앞 테스트의 리스너가 살아 남아 다음 테스트의 키를 먼저 먹는다
// (캡처에서 전파를 끊는 분기가 생긴 뒤로는 조용히 넘어가지 않는다)
afterEach(cleanup)

// Esc 하나를 둘이 노린다: 응답 중단 / 입력창 비우기(Composer).
// 임자를 못 가르면 한 번에 둘이 발동한다 — 양쪽 방향을 모두 잠근다.
describe('Esc — 응답 중단 vs 기존 동작', () => {
  const STREAMING: ShortcutContext = { ...IDLE, streaming: true }

  it('스트리밍 중이면 중단하고, 입력창까지 내려보내지 않는다', () => {
    mount(STREAMING)
    const { reached, prevented } = pressInBox({ key: 'Escape' })
    expect(handlers.onCancelTurn).toHaveBeenCalledTimes(1)
    expect(reached).toBe(false)
    expect(prevented).toBe(true)
  })

  it('스트리밍이 아니면 손대지 않는다 — 입력창의 두 번 눌러 비우기가 그대로 산다', () => {
    mount(IDLE)
    const { reached, prevented } = pressInBox({ key: 'Escape' })
    expect(handlers.onCancelTurn).not.toHaveBeenCalled()
    expect(reached).toBe(true)
    expect(prevented).toBe(false)
  })

  /*
   * Esc 는 턴 리뷰를 **거절하지 않는다.** 되살리려는 사람이 여기서 걸려야 한다.
   *
   * "vscode 엔 있는데 왜 없지" 로 되돌리지 말 것 — vscode 원본에는 Esc 로 파일이
   * 되돌아가는 경로가 없다:
   *   · 키바인딩 5개 전부 `when: activeWebviewPanelId == 'davisDiffPopup'` (전역 아님)
   *   · 웹뷰 Esc = `DiffApp.tsx:381` → `handleClose()` (그냥 닫기)
   *   · `davis.diff.reject` 는 주석 그대로 "now saves all changes" 라
   *     `_handleApplyAll()` 을 부른다 — 이름만 reject, 동작은 적용
   *     (`DiffPopupPanel.ts:342-344`)
   * 거절은 카드의 `거부` 버튼이 담당한다.
   */
  it('조작 가능한 리뷰가 있어도 Esc 로는 아무 일도 일어나지 않는다', () => {
    mount({ ...IDLE, canAcceptReview: true })
    const { reached, prevented } = pressInBox({ key: 'Escape' })
    expect(reached).toBe(true) // 우리가 안 먹었다 — 입력창 동작이 그대로 간다
    expect(prevented).toBe(false)
  })

  it('스트리밍 중 리뷰가 떠 있어도 Esc 는 중단만 한다', () => {
    mount({ ...IDLE, streaming: true, canAcceptReview: true })
    press({ key: 'Escape' })
    expect(handlers.onCancelTurn).toHaveBeenCalledTimes(1)
  })

  it('enabled=false 면 스트리밍 중이어도 안 먹는다', () => {
    mount(STREAMING, false)
    press({ key: 'Escape' })
    expect(handlers.onCancelTurn).not.toHaveBeenCalled()
  })
})

describe('⌘Enter — 턴 리뷰 전체 적용', () => {
  it('적용할 리뷰가 있으면 적용하고, 입력창 전송으로 내려보내지 않는다', () => {
    mount({ ...IDLE, canAcceptReview: true })
    const { reached, prevented } = pressInBox({ key: 'Enter', metaKey: true })
    expect(handlers.onAcceptReview).toHaveBeenCalledTimes(1)
    expect(reached).toBe(false)
    expect(prevented).toBe(true)
  })

  it('Ctrl 로도 먹는다', () => {
    mount({ ...IDLE, canAcceptReview: true })
    press({ key: 'Enter', ctrlKey: true })
    expect(handlers.onAcceptReview).toHaveBeenCalledTimes(1)
  })

  it('적용할 리뷰가 없으면 손대지 않는다 — 입력창 전송이 그대로 산다', () => {
    mount(IDLE)
    const { reached, prevented } = pressInBox({ key: 'Enter', metaKey: true })
    expect(handlers.onAcceptReview).not.toHaveBeenCalled()
    expect(reached).toBe(true)
    expect(prevented).toBe(false)
  })

  it('맨 Enter 는 건드리지 않는다 — 전송은 그대로', () => {
    mount({ ...IDLE, canAcceptReview: true })
    const { reached } = pressInBox({ key: 'Enter' })
    expect(handlers.onAcceptReview).not.toHaveBeenCalled()
    expect(reached).toBe(true)
  })
})

// **셸 칸에서의 Esc 는 셸 것이다.** 칸은 터미널이고 Esc 는 거기서 vim·less·readline
// vi 모드가 쓰는 기본 키다. 캡처가 먼저 돌아 stopPropagation 까지 하므로, 여기서 안
// 가르면 **xterm 이 그 키를 보지도 못한다** (`belongsToApp` 은 이 경로에 표를 못 던진다).
describe('셸 칸의 Esc', () => {
  const STREAMING: ShortcutContext = { streaming: true, canAcceptReview: false }

  /** 칸 안에서 누른 것처럼 — 포커스는 xterm 이 숨겨 둔 textarea 다 */
  function pressInDrawer(init: KeyboardEventInit): boolean {
    const drawer = document.createElement('div')
    drawer.className = 'drawer'
    const hidden = document.createElement('textarea')
    drawer.appendChild(hidden)
    document.body.appendChild(drawer)

    const prevented = pressOn(hidden, init)
    drawer.remove()
    return prevented
  }

  it('칸에서 누른 Esc 는 턴을 끊지 않는다 — 셸로 내려보낸다', () => {
    mount(STREAMING)
    const prevented = pressInDrawer({ key: 'Escape' })

    expect(handlers.onCancelTurn).not.toHaveBeenCalled()
    // 안 막아야 xterm 이 받아 셸로 보낸다
    expect(prevented).toBe(false)
  })

  // 대가를 못 박아 둔다 — 칸 밖에서는 그대로 끊긴다. ⌘↑ 로 나오면 되는 이유다.
  it('칸 밖에서는 그대로 끊는다', () => {
    mount(STREAMING)
    press({ key: 'Escape' })
    expect(handlers.onCancelTurn).toHaveBeenCalledTimes(1)
  })

  // **⌘Enter 는 안 가른다** — 셸에서 뜻이 없는 조합이라 칸에 있어도 앱이 가져간다
  it('칸에서도 ⌘Enter 는 리뷰를 적용한다', () => {
    mount({ streaming: false, canAcceptReview: true })
    pressInDrawer({ key: 'Enter', metaKey: true })
    expect(handlers.onAcceptReview).toHaveBeenCalledTimes(1)
  })
})
