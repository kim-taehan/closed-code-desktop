// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, fireEvent } from '@testing-library/react'
import { useMouseGesture } from './useMouseGesture'
import { tabNavigation } from './tabCycle'
import type { OpenFilesApi } from './useOpenFiles'

// 우클릭 드래그 'ㄴ' 추적 훅. 판정 규칙 자체는 mouseGesture.test 가 잠그고,
// 여기서는 포인터 이벤트 → 콜백/컨텍스트 메뉴 억제의 배선을 확인한다.

function Target({ onGesture }: { onGesture: (kind: string) => void }) {
  const gesture = useMouseGesture(onGesture)
  return <div data-testid="target" {...gesture.handlers} />
}

function setup() {
  const onGesture = vi.fn()
  const { getByTestId } = render(<Target onGesture={onGesture} />)
  return { onGesture, target: getByTestId('target') }
}

/** 우클릭으로 ㄴ 을 그린다: (100,100) → 아래 (100,220) → 오른쪽 (220,220) */
function drawL(target: HTMLElement, button = 2) {
  fireEvent.pointerDown(target, { button, clientX: 100, clientY: 100 })
  for (let y = 120; y <= 220; y += 20) fireEvent.pointerMove(target, { clientX: 100, clientY: y })
  for (let x = 120; x <= 220; x += 20) fireEvent.pointerMove(target, { clientX: x, clientY: 220 })
  fireEvent.pointerUp(target, { button, clientX: 220, clientY: 220 })
}

afterEach(cleanup)

describe('useMouseGesture', () => {
  it('우클릭 드래그로 ㄴ 을 그리면 종류 L 로 콜백이 불린다', () => {
    const { onGesture, target } = setup()
    drawL(target)
    expect(onGesture).toHaveBeenCalledTimes(1)
    expect(onGesture).toHaveBeenCalledWith('L')
  })

  it('수평 우측 드래그는 swipe-right 로 콜백이 불린다', () => {
    const { onGesture, target } = setup()
    fireEvent.pointerDown(target, { button: 2, clientX: 100, clientY: 100 })
    for (let x = 120; x <= 240; x += 20) fireEvent.pointerMove(target, { clientX: x, clientY: 100 })
    fireEvent.pointerUp(target, { button: 2, clientX: 240, clientY: 100 })
    expect(onGesture).toHaveBeenCalledWith('swipe-right')
  })

  it('인식 직후의 contextmenu 는 1회만 억제된다', () => {
    const { target } = setup()
    drawL(target)
    // fireEvent 는 preventDefault 가 불리면 false 를 돌려준다
    expect(fireEvent.contextMenu(target)).toBe(false)
    expect(fireEvent.contextMenu(target)).toBe(true)
  })

  it('그냥 우클릭(드래그 없음)은 콜백도 억제도 없다 — 기본 동작 유지', () => {
    const { onGesture, target } = setup()
    fireEvent.pointerDown(target, { button: 2, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(target, { button: 2, clientX: 100, clientY: 100 })
    expect(onGesture).not.toHaveBeenCalled()
    expect(fireEvent.contextMenu(target)).toBe(true)
  })

  it('좌클릭 드래그는 무시한다 — 텍스트 선택과 충돌하지 않게', () => {
    const { onGesture, target } = setup()
    drawL(target, 0)
    expect(onGesture).not.toHaveBeenCalled()
  })

  it('영역을 벗어나면 취소된다 — 돌아와서 떼도 콜백이 없다', () => {
    const { onGesture, target } = setup()
    fireEvent.pointerDown(target, { button: 2, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(target, { clientX: 100, clientY: 220 })
    fireEvent.pointerLeave(target)
    fireEvent.pointerMove(target, { clientX: 220, clientY: 220 })
    fireEvent.pointerUp(target, { button: 2, clientX: 220, clientY: 220 })
    expect(onGesture).not.toHaveBeenCalled()
  })
})

// 대화 영역은 이동 제스처만 허용된다 (스펙 변경: 채팅 미적용 → 이동만).
// App 의 chat 래퍼와 같은 조합(제스처 훅 + tabNavigation)으로 잠근다.
describe('대화 영역 배선 — 이동만, ㄴ 은 조용히 무시', () => {
  function chatSetup() {
    const openFiles: OpenFilesApi = {
      files: [{ path: '/a.ts', text: '' }],
      active: 'chat',
      open: vi.fn(),
      openRouted: vi.fn(),
      openDiff: vi.fn(),
  openHtml: vi.fn(),
      close: vi.fn(),
      closeMany: vi.fn(),
      select: vi.fn(),
      edit: vi.fn(),
      flush: vi.fn(),
      setSelection: vi.fn(),
      chatContext: { dirtyFiles: [] },
    }
    const closeLogs = vi.fn()
    function ChatArea() {
      const nav = tabNavigation(openFiles, false, closeLogs)
      const gesture = useMouseGesture((kind) => {
        if (kind === 'L') nav.closeActive()
        else if (kind === 'swipe-right') nav.next()
        else nav.prev()
      })
      return <div data-testid="target" {...gesture.handlers} />
    }
    const { getByTestId } = render(<ChatArea />)
    return { openFiles, closeLogs, target: getByTestId('target') }
  }

  it('스와이프는 대화에서도 탭을 넘긴다', () => {
    const { openFiles, target } = chatSetup()
    fireEvent.pointerDown(target, { button: 2, clientX: 100, clientY: 100 })
    for (let x = 120; x <= 240; x += 20) fireEvent.pointerMove(target, { clientX: x, clientY: 100 })
    fireEvent.pointerUp(target, { button: 2, clientX: 240, clientY: 100 })
    expect(openFiles.select).toHaveBeenCalledWith('/a.ts')
  })

  it('ㄴ 은 대화에서 조용히 무시된다 — 닫힘도 에러도 없다', () => {
    const { openFiles, closeLogs, target } = chatSetup()
    drawL(target)
    expect(openFiles.close).not.toHaveBeenCalled()
    expect(closeLogs).not.toHaveBeenCalled()
    expect(openFiles.select).not.toHaveBeenCalled()
  })

  it('일반 우클릭의 컨텍스트 메뉴는 산다 — 대화의 텍스트 복사 수요', () => {
    const { target } = chatSetup()
    fireEvent.pointerDown(target, { button: 2, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(target, { button: 2, clientX: 10, clientY: 10 })
    expect(fireEvent.contextMenu(target)).toBe(true)
  })
})
