// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitBranchChip, type GitBranchMenu } from './GitBranchChip'

afterEach(cleanup)

describe('브랜치 칩', () => {
  it('브랜치 이름을 보여준다', () => {
    render(<GitBranchChip branch="feat/extension-settings-screen" />)

    expect(screen.getByText('feat/extension-settings-screen')).toBeTruthy()
  })

  it('브랜치가 없으면 분리된 HEAD 라고 알린다', () => {
    render(<GitBranchChip branch={null} />)

    expect(screen.getByText('HEAD 분리됨')).toBeTruthy()
  })

  // 메뉴를 못 주는 자리(목록을 안 읽는 껍데기)에서는 눌리지 않는 캐럿을 그리지 않는다.
  // ⚠ 사이드바는 이제 준다 — 그 자리는 `GitPanel.test.tsx` 가 잠근다 (QA D6).
  it('메뉴를 주지 않으면 누를 것을 그리지 않는다', () => {
    const { container } = render(<GitBranchChip branch="main" />)

    expect(container.querySelector('button')).toBeNull()
    expect(container.textContent).not.toContain('▾')
  })
})

describe('브랜치 칩 — 전환 메뉴', () => {
  function menu(patch: Partial<GitBranchMenu> = {}): GitBranchMenu {
    return {
      branches: [
        { name: 'main', remote: false, date: '', track: '', current: true },
        { name: 'feat/x', remote: false, date: '', track: '', current: false },
      ],
      busy: false,
      onSwitch: vi.fn(),
      onCreate: vi.fn(),
      ...patch,
    }
  }

  it('메뉴를 주면 캐럿을 그리고, 열면 지금 브랜치를 뺀 나머지가 뜬다', () => {
    render(<GitBranchChip branch="main" menu={menu()} />)
    expect(screen.getByText('▾')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /main/ }))

    expect(screen.getByRole('menuitem', { name: 'feat/x' })).toBeTruthy()
    // 지금 있는 브랜치로는 옮길 수 없다 — 목록에 두지 않는다
    expect(screen.queryByRole('menuitem', { name: 'main' })).toBeNull()
  })

  it('고르면 그 브랜치로 옮기라고 알리고 메뉴를 닫는다', () => {
    const api = menu()
    render(<GitBranchChip branch="main" menu={api} />)
    fireEvent.click(screen.getByRole('button', { name: /main/ }))

    fireEvent.click(screen.getByRole('menuitem', { name: 'feat/x' }))

    expect(api.onSwitch).toHaveBeenCalledWith('feat/x')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('옮겨 갈 곳이 없으면 그렇게 말한다 — 빈 메뉴를 열지 않는다', () => {
    render(
      <GitBranchChip
        branch="main"
        menu={menu({ branches: [{ name: 'main', remote: false, date: '', track: '', current: true }] })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /main/ }))

    expect(screen.getByText('옮겨 갈 브랜치가 없습니다.')).toBeTruthy()
  })

  it('메뉴에서 새 브랜치를 만들 수 있다', () => {
    const api = menu()
    render(<GitBranchChip branch="main" menu={api} />)
    fireEvent.click(screen.getByRole('button', { name: /main/ }))

    fireEvent.click(screen.getByText('+ 새 브랜치'))
    fireEvent.change(screen.getByLabelText('새 브랜치 이름'), { target: { value: 'feat/y' } })
    fireEvent.submit(screen.getByLabelText('새 브랜치 이름'))

    expect(api.onCreate).toHaveBeenCalledWith('feat/y')
  })
})
