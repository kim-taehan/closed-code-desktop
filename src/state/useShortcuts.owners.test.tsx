// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApprovalModal } from '../components/ApprovalModal'
import { ComposerAdd } from '../components/ComposerAdd'
import { MentionPopup } from '../components/MentionPopup'
import { SkillPicker } from '../components/SkillPicker'
import { SlashPopup } from '../components/SlashPopup'
import { useShortcuts, type ShortcutContext, type ShortcutHandlers } from './useShortcuts'

// Esc·⌘Enter 의 **임자 판정**만 모은다 (`useShortcuts.ts` 의 `borrowed`).
//
// 이 축은 화면에 덮개가 하나 늘 때마다 자란다 — 그래서 동작 테스트(turnKeys)와 갈라 뒀다.
// 전부 **진짜 컴포넌트**를 띄워 잠근다: 마크업을 지어내면 그쪽이 바뀌어도 안 깨진다.
// 전파를 끊는지까지 봐야 해서 단언의 결이 다르다.
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


// 우리는 window 캡처라 **전파 경로 뒤쪽을 전부** 막는다. 드롭다운은 document 버블로,
// 팔레트·이름 편집은 React onKeyDown 으로 Esc 를 듣는다 — 먼저 삼키면 그것들은 열린 채
// 남고 엉뚱하게 턴이 끊긴다. 마크업을 지어내지 않고 **진짜 컴포넌트**를 띄워 잠근다.
describe('Esc — 이미 임자가 있으면 넘긴다', () => {
  const STREAMING: ShortcutContext = { ...IDLE, streaming: true }

  it('열린 드롭다운(role=menu)이 있으면 넘긴다 — 메뉴가 닫혀야지 턴이 끊기면 안 된다', () => {
    render(<ComposerAdd onPick={() => {}} onSkills={() => {}} onConnectors={() => {}} />)
    fireEvent.click(screen.getByTitle('추가'))
    mount(STREAMING)

    // 드롭다운은 document 버블로 듣는다 — 전파가 거기까지 가야 닫힌다.
    // 닫힘은 React state 라 act 로 감싸 흘려보내야 화면에 반영된다 (fireEvent 가 해 준다)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(handlers.onCancelTurn).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull() // 메뉴는 제 할 일을 했다
  })

  it('닫히고 나면 다시 우리 것이다', () => {
    render(<ComposerAdd onPick={() => {}} onSkills={() => {}} onConnectors={() => {}} />)
    const toggle = screen.getByTitle('추가')
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    mount(STREAMING)

    press({ key: 'Escape' })
    expect(handlers.onCancelTurn).toHaveBeenCalledTimes(1)
  })

  it('열린 목록(role=listbox)이 있으면 넘긴다 — 슬래시·@멘션 팝업도 이 역할이다', () => {
    const list = document.createElement('div')
    list.setAttribute('role', 'listbox')
    document.body.appendChild(list)
    mount(STREAMING)

    press({ key: 'Escape' })
    expect(handlers.onCancelTurn).not.toHaveBeenCalled()
    list.remove()
  })

  // 팝업이 0행일 때 DOM 에서 사라지면 임자 판정이 팝업을 못 본다 — `/zzzz` 를 치고 Esc 를
  // 누르면 팝업은 제 리스너로 닫히면서 같은 Esc 가 턴까지 끊는다.
  // 상자를 남기는 쪽(SlashPopup.tsx)이 고쳐졌는지 **진짜 컴포넌트**로 잠근다.
  it('일치 0행인 슬래시 팝업도 임자다 — 상자가 DOM 에 남는다', async () => {
    ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
    ;(window as unknown as { davis: unknown }).davis = { listSkills: () => Promise.resolve({ skills: [] }) }
    render(<SlashPopup query="zzzz" onPick={() => {}} onClose={() => {}} />)
    // 일치가 없으니 보이는 항목은 하나도 없다 — 그래도 상자는 DOM 에 있어야 한다
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0)

    mount({ ...IDLE, canAcceptReview: true })
    press({ key: 'Enter', metaKey: true })
    expect(handlers.onAcceptReview).not.toHaveBeenCalled()
  })

  it('일치 0행 팝업은 스트리밍 중단도 넘긴다 — 팝업이 먼저 닫혀야 한다', async () => {
    ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
    ;(window as unknown as { davis: unknown }).davis = { listSkills: () => Promise.resolve({ skills: [] }) }
    render(<SlashPopup query="zzzz" onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())

    mount(STREAMING)
    press({ key: 'Escape' })
    expect(handlers.onCancelTurn).not.toHaveBeenCalled()
  })

  it('input 에서 누른 Esc 는 넘긴다 — 빠른 열기·검색·이름 편집이 그걸로 닫힌다', () => {
    const box = document.createElement('input')
    document.body.appendChild(box)
    mount(STREAMING)

    pressOn(box, { key: 'Escape' })
    expect(handlers.onCancelTurn).not.toHaveBeenCalled()
    box.remove()
  })

  it('textarea 는 넘기지 않는다 — 입력창의 두 번 눌러 비우기보다 중단이 앞선다', () => {
    mount(STREAMING)
    const { reached } = pressInBox({ key: 'Escape' })
    expect(handlers.onCancelTurn).toHaveBeenCalledTimes(1)
    expect(reached).toBe(false)
  })

  // 트리의 열린 폴더·펼친 턴 헤더가 평상시에 aria-expanded=true 다.
  // 그걸 임자로 보면 Esc 가 아예 안 먹는다 — 완화 방향 회귀를 여기서 거부한다.
  it('펼쳐진 트리·턴 헤더는 임자가 아니다', () => {
    const row = document.createElement('button')
    row.setAttribute('role', 'treeitem')
    row.setAttribute('aria-expanded', 'true')
    document.body.appendChild(row)
    mount(STREAMING)

    press({ key: 'Escape' })
    expect(handlers.onCancelTurn).toHaveBeenCalledTimes(1)
    row.remove()
  })

  // Esc 를 **안 듣는** 모달도 임자다. 화면을 덮고 있는데 뒤에서 파일이 되돌아가면 안 된다 —
  // 판정 기준은 "Esc 를 듣는가" 가 아니라 "덮고 있는가" 다 (SkillPicker 는 백드롭 클릭만 듣는다).
  it('열린 모달(role=dialog)이 있으면 넘긴다 — Esc 를 안 듣는 모달이라도', () => {
    ;(window as unknown as { davis: unknown }).davis = {
      listSkills: () => Promise.resolve({ skills: [] }),
    }
    render(<SkillPicker onPick={() => {}} onClose={() => {}} />)
    mount(STREAMING)

    press({ key: 'Escape' })
    expect(handlers.onCancelTurn).not.toHaveBeenCalled()
  })

  // 일치 0행이면 팝업이 DOM 에서 사라져 가드가 뚫렸던 자리 (SlashPopup·MentionPopup 양쪽).
  // 두 컴포넌트가 '빈 상자를 남기는' 처방을 지켜야 이 테스트가 통과한다.
  it('일치 0행인 @멘션 팝업도 임자다 — 빈 상자가 DOM 에 남는다', async () => {
    ;(window as unknown as { davis: unknown }).davis = {
      listFiles: () => Promise.resolve({ files: ['src/App.tsx'], dirs: [], truncated: false }),
    }
    render(<MentionPopup query="zzzzzz" onPick={() => {}} onClose={() => {}} includeDirs />)
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
    mount(STREAMING)

    press({ key: 'Escape' })
    expect(handlers.onCancelTurn).not.toHaveBeenCalled()
  })

  /*
   * HIL 인터럽트(승인·질문·계획)는 임자가 **아니다.**
   *
   * 그 셋은 턴이 사용자를 기다리는 상태다 — 턴은 멈춰 있고 `.dc-modal` 이 화면을 덮어
   * 중단 버튼도 못 누른다. 여기서 Esc 까지 막으면 턴을 접을 길이 아예 없어진다.
   */
  it('승인 모달이 떠 있으면 Esc 가 턴을 중단한다 — 접을 길이 여기뿐이다', () => {
    render(
      <ApprovalModal
        request={{ requestId: 'r1', toolName: 'run_command', args: {} }}
        onRespond={() => {}}
      />,
    )
    mount(STREAMING)

    press({ key: 'Escape' })
    expect(handlers.onCancelTurn).toHaveBeenCalledTimes(1)
  })

  // 인터럽트 위에 다른 모달이 겹치면 그쪽이 임자다 — 겹친 경우는 종전대로 막힌다
  it('인터럽트 위에 턴과 무관한 모달이 겹쳐 있으면 다시 막힌다', () => {
    ;(window as unknown as { davis: unknown }).davis = {
      listSkills: () => Promise.resolve({ skills: [] }),
    }
    render(
      <ApprovalModal
        request={{ requestId: 'r1', toolName: 'run_command', args: {} }}
        onRespond={() => {}}
      />,
    )
    render(<SkillPicker onPick={() => {}} onClose={() => {}} />)
    mount(STREAMING)

    press({ key: 'Escape' })
    expect(handlers.onCancelTurn).not.toHaveBeenCalled()
  })

  it('⌘Enter 도 같은 규칙을 쓴다', () => {
    render(<ComposerAdd onPick={() => {}} onSkills={() => {}} onConnectors={() => {}} />)
    fireEvent.click(screen.getByTitle('추가'))
    mount({ ...IDLE, canAcceptReview: true })

    press({ key: 'Enter', metaKey: true })
    expect(handlers.onAcceptReview).not.toHaveBeenCalled()
  })
})
