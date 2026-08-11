// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useShortcuts, type ShortcutContext, type ShortcutHandlers } from './useShortcuts'

// 창 전체 단축키 — 수식키(Cmd/Ctrl) 조합. enabled=false 면 아무것도 안 건다.
// 수식키 없이 도는 Esc·⌘Enter 는 useShortcuts.turnKeys.test.tsx 가 본다.

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

let handlers: ReturnType<typeof makeHandlers>
beforeEach(() => {
  handlers = makeHandlers()
})
// 안 치우면 앞 테스트의 리스너가 살아 남아 다음 테스트의 키를 먼저 먹는다
// (캡처에서 전파를 끊는 분기가 생긴 뒤로는 조용히 넘어가지 않는다)
afterEach(cleanup)

describe('단축키 — 켜져 있을 때', () => {
  it('Cmd+P 는 빠른 열기, 기본동작을 막는다', () => {
    mount()
    const prevented = press({ key: 'p', metaKey: true })
    expect(handlers.onQuickOpen).toHaveBeenCalledTimes(1)
    expect(prevented).toBe(true)
  })

  it('Ctrl 로도 (Cmd 없이) 먹는다', () => {
    mount()
    press({ key: 'p', ctrlKey: true })
    expect(handlers.onQuickOpen).toHaveBeenCalledTimes(1)
  })

  it('대문자 P 도 소문자로 보고 먹는다', () => {
    mount()
    press({ key: 'P', metaKey: true })
    expect(handlers.onQuickOpen).toHaveBeenCalledTimes(1)
  })

  it('Cmd+Shift+F 는 검색', () => {
    mount()
    press({ key: 'f', metaKey: true, shiftKey: true })
    expect(handlers.onSearch).toHaveBeenCalledTimes(1)
  })

  it('Shift 없는 Cmd+F 는 검색이 아니다', () => {
    mount()
    press({ key: 'f', metaKey: true })
    expect(handlers.onSearch).not.toHaveBeenCalled()
  })

  it('Cmd+N 은 새 대화, Shift 가 붙으면 아니다', () => {
    mount()
    press({ key: 'n', metaKey: true })
    expect(handlers.onNewChat).toHaveBeenCalledTimes(1)
    press({ key: 'n', metaKey: true, shiftKey: true })
    expect(handlers.onNewChat).toHaveBeenCalledTimes(1) // 늘지 않음
  })

  it('Shift 붙은 Cmd+P 는 무시한다', () => {
    mount()
    press({ key: 'p', metaKey: true, shiftKey: true })
    expect(handlers.onQuickOpen).not.toHaveBeenCalled()
  })

  it('Cmd+, 는 설정, Shift 여부를 따지지 않는다', () => {
    mount()
    press({ key: ',', metaKey: true })
    press({ key: ',', metaKey: true, shiftKey: true })
    expect(handlers.onSettings).toHaveBeenCalledTimes(2)
  })

  it('Cmd+L 은 로그 탭, 기본동작을 막는다', () => {
    const onLogs = vi.fn()
    renderHook(() => useShortcuts({ ...handlers, onLogs }, true, IDLE))
    const prevented = press({ key: 'l', metaKey: true })
    expect(onLogs).toHaveBeenCalledTimes(1)
    expect(prevented).toBe(true)
  })

  // 개발자 모드가 아니면 App 이 onLogs 를 아예 넘기지 않는다 — ⚙ 메뉴에 항목이 없는 것과 같은 조건.
  // 목록에 있는데 안 먹는(또는 안 보이는데 먹는) 어긋남을 여기서 잠근다.
  it('onLogs 가 없으면 Cmd+L 을 건드리지 않는다 — 개발자 모드 전용', () => {
    mount()
    const prevented = press({ key: 'l', metaKey: true })
    expect(prevented).toBe(false)
  })

  it('Cmd+W 는 탭 닫기, 기본동작을 막는다 — 창 닫기는 appMenu 가 이미 뺐다', () => {
    mount()
    const prevented = press({ key: 'w', metaKey: true })
    expect(handlers.onCloseTab).toHaveBeenCalledTimes(1)
    expect(prevented).toBe(true)
  })

  it('Ctrl+Tab 은 다음 탭, Ctrl+Shift+Tab 은 이전 탭 (크롬 관례 — macOS 도 Ctrl)', () => {
    mount()
    press({ key: 'Tab', ctrlKey: true })
    expect(handlers.onNextTab).toHaveBeenCalledTimes(1)
    press({ key: 'Tab', ctrlKey: true, shiftKey: true })
    expect(handlers.onPrevTab).toHaveBeenCalledTimes(1)
  })

  it('Cmd+Tab(Ctrl 아님)은 탭 순환이 아니다 — OS 앱 전환에 맡긴다', () => {
    mount()
    press({ key: 'Tab', metaKey: true })
    expect(handlers.onNextTab).not.toHaveBeenCalled()
  })

  it('Cmd+Alt+→ 는 다음 프로젝트, Cmd+Alt+← 는 이전 프로젝트', () => {
    mount()
    const prevented = press({ key: 'ArrowRight', metaKey: true, altKey: true })
    expect(handlers.onNextProject).toHaveBeenCalledTimes(1)
    expect(prevented).toBe(true)
    press({ key: 'ArrowLeft', metaKey: true, altKey: true })
    expect(handlers.onPrevProject).toHaveBeenCalledTimes(1)
  })

  it('Alt 없는 Cmd+←·→ 는 건드리지 않는다 — 입력창의 줄 처음/끝 이동을 남겨 둔다', () => {
    mount()
    const prevented = press({ key: 'ArrowLeft', metaKey: true })
    expect(handlers.onPrevProject).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  it('입력창·편집기 안에서도 먹는다 — Alt 를 끼워 충돌이 없기 때문', () => {
    mount()
    const box = document.createElement('textarea')
    document.body.appendChild(box)
    pressOn(box, { key: 'ArrowRight', metaKey: true, altKey: true })
    expect(handlers.onNextProject).toHaveBeenCalledTimes(1)
    box.remove()
  })

  it('수식키(Cmd/Ctrl) 없이 눌러도 아무 일 없다', () => {
    mount()
    const prevented = press({ key: 'p' })
    expect(handlers.onQuickOpen).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  it('매핑에 없는 키는 무시한다', () => {
    mount()
    press({ key: 'x', metaKey: true })
    expect(handlers.onQuickOpen).not.toHaveBeenCalled()
    expect(handlers.onSearch).not.toHaveBeenCalled()
  })
})

describe('단축키 — 꺼짐/정리', () => {
  it('enabled=false 면 리스너를 걸지 않는다', () => {
    mount(IDLE, false)
    press({ key: 'p', metaKey: true })
    expect(handlers.onQuickOpen).not.toHaveBeenCalled()
  })

  it('언마운트하면 더는 반응하지 않는다', () => {
    const { unmount } = mount()
    unmount()
    press({ key: 'p', metaKey: true })
    expect(handlers.onQuickOpen).not.toHaveBeenCalled()
  })
})
