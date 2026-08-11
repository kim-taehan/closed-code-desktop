// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScmCommitBar } from './ScmCommitBar'

// 커밋바. 메뉴에는 **채널이 있는 넷만** 있고, 지금 쓸 수 없는 항목은 회색이다.

afterEach(cleanup)

function mkMenu() {
  return {
    onCommitAll: vi.fn(),
    onCommitPush: vi.fn(),
    onAmend: vi.fn(),
    onUndoCommit: vi.fn(),
  }
}

function setup(patch: Partial<Parameters<typeof ScmCommitBar>[0]> = {}) {
  const menu = mkMenu()
  const onCommit = vi.fn()
  const onPush = vi.fn()
  render(
    <ScmCommitBar
      hasStaged
      stagedCount={2}
      canPush
      busy={false}
      onCommit={onCommit}
      onPush={onPush}
      menu={menu}
      {...patch}
    />,
  )
  return { menu, onCommit, onPush }
}

function open(): void {
  fireEvent.click(screen.getByRole('button', { name: '커밋 방식 더 보기' }))
}

function write(text: string): void {
  fireEvent.change(screen.getByPlaceholderText('커밋 메시지'), { target: { value: text } })
}

describe('커밋', () => {
  it('메시지가 없으면 커밋할 수 없다', () => {
    setup()
    expect(screen.getByRole('button', { name: '커밋' }).hasAttribute('disabled')).toBe(true)
  })

  it('담긴 것이 없으면 메시지를 써도 커밋할 수 없다', () => {
    setup({ hasStaged: false })
    write('메시지')
    expect(screen.getByRole('button', { name: '커밋' }).hasAttribute('disabled')).toBe(true)
  })

  it('⌘↵ 로도 커밋한다 — 그냥 ↵ 는 줄바꿈이다', () => {
    const { onCommit } = setup()
    write('메시지')
    const input = screen.getByPlaceholderText('커밋 메시지')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    expect(onCommit).toHaveBeenCalledWith('메시지')
  })
})

describe('커밋 ▾ 메뉴', () => {
  it('채널이 있는 넷만 있다', () => {
    setup()
    open()

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      '모두 담고 커밋',
      '커밋 후 푸시',
      '마지막 커밋에 합치기',
      '커밋 취소',
    ])
  })

  it('메뉴 항목은 지금 쓴 메시지를 받는다', () => {
    const { menu } = setup()
    write(' 메시지 ')
    open()

    fireEvent.click(screen.getByRole('menuitem', { name: '모두 담고 커밋' }))

    expect(menu.onCommitAll).toHaveBeenCalledWith('메시지')
  })

  // 담긴 게 없어도 「모두 담고 커밋」은 담기부터 하므로 쓸 수 있다 — 그게 이 항목의 쓸모다
  it('담긴 것이 없어도 「모두 담고 커밋」은 쓸 수 있다', () => {
    setup({ hasStaged: false })
    write('메시지')
    open()

    expect(screen.getByRole('menuitem', { name: '모두 담고 커밋' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('menuitem', { name: '커밋 후 푸시' }).hasAttribute('disabled')).toBe(true)
  })

  it('메시지가 없으면 메시지를 쓰는 항목만 회색이다', () => {
    setup()
    open()

    expect(screen.getByRole('menuitem', { name: '마지막 커밋에 합치기' }).hasAttribute('disabled')).toBe(true)
    // 커밋 취소는 메시지를 쓰지 않는다
    expect(screen.getByRole('menuitem', { name: '커밋 취소' }).hasAttribute('disabled')).toBe(false)
  })

  it('「커밋 취소」는 쓰던 글을 지우지 않는다', () => {
    setup()
    write('쓰던 글')
    open()

    fireEvent.click(screen.getByRole('menuitem', { name: '커밋 취소' }))

    const input = screen.getByPlaceholderText('커밋 메시지') as HTMLTextAreaElement
    expect(input.value).toBe('쓰던 글')
  })

  it('바깥을 누르면 닫힌다', () => {
    setup()
    open()
    expect(screen.getAllByRole('menuitem')).toHaveLength(4)

    fireEvent.mouseDown(document.body)

    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  })
})

describe('푸시', () => {
  it('올릴 것이 없으면 누를 수 없다', () => {
    setup({ canPush: false })
    expect(screen.getByRole('button', { name: '푸시' }).hasAttribute('disabled')).toBe(true)
  })
})
