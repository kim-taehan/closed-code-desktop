// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { ComposerAdd } from './ComposerAdd'

// 입력창 "+" 메뉴. 열고/닫고, 항목이 올바른 콜백을 부르며 닫히고,
// disabled 면 안 열리고, Esc·바깥 클릭으로 닫힌다.

function setup(over: Partial<Parameters<typeof ComposerAdd>[0]> = {}) {
  const props = {
    onPick: vi.fn(),
    onSkills: vi.fn(),
    onConnectors: vi.fn(),
    ...over,
  }
  render(<ComposerAdd {...props} />)
  return props
}

function toggle() {
  return screen.getByTitle('추가')
}

afterEach(cleanup)

describe('ComposerAdd — 열기/닫기', () => {
  it('처음엔 메뉴가 닫혀 있다', () => {
    setup()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('토글을 누르면 메뉴 세 항목이 열린다', () => {
    setup()
    fireEvent.click(toggle())
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
  })

  it('다시 누르면 닫힌다', () => {
    setup()
    fireEvent.click(toggle())
    fireEvent.click(toggle())
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('disabled 면 토글이 눌리지 않아 메뉴가 안 열린다', () => {
    setup({ disabled: true })
    expect((toggle() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(toggle())
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ComposerAdd — 항목 선택', () => {
  it('"파일 또는 이미지 추가"는 onPick 을 부르고 닫는다', () => {
    const p = setup()
    fireEvent.click(toggle())
    fireEvent.click(screen.getByText('파일 또는 이미지 추가'))
    expect(p.onPick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('"스킬"은 onSkills 를 부르고 닫는다', () => {
    const p = setup()
    fireEvent.click(toggle())
    fireEvent.click(screen.getByText('스킬'))
    expect(p.onSkills).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('"커넥터"는 onConnectors 를 부르고 닫는다', () => {
    const p = setup()
    fireEvent.click(toggle())
    fireEvent.click(screen.getByText('커넥터'))
    expect(p.onConnectors).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ComposerAdd — 바깥 상호작용으로 닫기', () => {
  it('Esc 로 닫는다', () => {
    setup()
    fireEvent.click(toggle())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('메뉴 바깥을 클릭하면 닫는다', () => {
    setup()
    fireEvent.click(toggle())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
