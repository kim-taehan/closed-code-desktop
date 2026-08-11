// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PermissionMode } from '../../shared/protocol/kinds'
import { PermissionModeSwitch, nextMode } from './PermissionModeSwitch'

afterEach(cleanup)

describe('모드 순환', () => {
  // acceptEdits 는 opencode 에 대응 에이전트가 없어 목록에서 뺐다 (kinds.ts) — 두 칸만 돈다
  it('default → plan → default 로 돈다', () => {
    expect(nextMode(PermissionMode.DEFAULT)).toBe(PermissionMode.PLAN)
    expect(nextMode(PermissionMode.PLAN)).toBe(PermissionMode.DEFAULT)
  })
})

describe('표시', () => {
  // 이름은 영문 그대로 쓴다 — runtime·vscode·IntelliJ 가 모두 이 이름으로 부른다
  it('현재 모드 이름을 보여준다', () => {
    render(<PermissionModeSwitch mode={PermissionMode.PLAN} onChange={() => {}} />)
    expect(screen.getByText('plan')).toBeTruthy()
  })

  it('모드별 클래스가 붙는다 — 기본이 아닌 모드는 눈에 띄어야 한다', () => {
    const { container } = render(
      <PermissionModeSwitch mode={PermissionMode.PLAN} onChange={() => {}} />,
    )
    expect(container.querySelector('.modes-btn--plan')).toBeTruthy()
  })

  it('기본 모드에는 강조 클래스를 붙이지 않는다', () => {
    const { container } = render(
      <PermissionModeSwitch mode={PermissionMode.DEFAULT} onChange={() => {}} />,
    )
    expect(container.querySelector('.modes-btn--default')).toBeNull()
  })

  it('툴팁에 모드 설명과 단축키가 있다', () => {
    const { container } = render(<PermissionModeSwitch mode={PermissionMode.PLAN} onChange={() => {}} />)
    const title = container.querySelector('button')!.getAttribute('title')!

    expect(title).toContain('계획을 수립')
    expect(title).toContain('Shift+Tab')
  })
})

describe('메뉴', () => {
  it('닫혀 있으면 목록을 그리지 않는다', () => {
    render(<PermissionModeSwitch mode={PermissionMode.DEFAULT} onChange={() => {}} />)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('누르면 두 모드를 설명과 함께 펼친다', () => {
    render(<PermissionModeSwitch mode={PermissionMode.DEFAULT} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
    // 문구를 줄이지 않는다 — plan 은 편집만 막고 셸·탐색은 돈다
    expect(screen.getByText('코드를 탐색하고 편집 전 계획을 수립')).toBeTruthy()
  })

  it('지금 모드를 선택됨으로 표시한다', () => {
    render(<PermissionModeSwitch mode={PermissionMode.PLAN} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button'))

    const checked = screen
      .getAllByRole('menuitemradio')
      .filter((item) => item.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0]!.textContent).toContain('plan')
  })

  it('고르면 그 모드로 바로 간다 — 순환이 아니다', () => {
    const onChange = vi.fn()
    render(<PermissionModeSwitch mode={PermissionMode.DEFAULT} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('plan'))

    expect(onChange).toHaveBeenCalledWith(PermissionMode.PLAN)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Escape 로 닫는다', () => {
    render(<PermissionModeSwitch mode={PermissionMode.DEFAULT} onChange={() => {}} />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('전환', () => {

  it('Shift+Tab 으로도 전환된다', () => {
    const onChange = vi.fn()
    render(<PermissionModeSwitch mode={PermissionMode.PLAN} onChange={onChange} />)

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(onChange).toHaveBeenCalledWith(PermissionMode.DEFAULT)
  })

  it('Shift 없는 Tab 은 건드리지 않는다 — 일반 포커스 이동은 그대로 둔다', () => {
    const onChange = vi.fn()
    render(<PermissionModeSwitch mode={PermissionMode.DEFAULT} onChange={onChange} />)

    fireEvent.keyDown(window, { key: 'Tab' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('비활성이면 클릭도 단축키도 안 먹는다', () => {
    const onChange = vi.fn()
    render(<PermissionModeSwitch mode={PermissionMode.DEFAULT} onChange={onChange} disabled />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })

    expect(onChange).not.toHaveBeenCalled()
    // 비활성이면 메뉴도 열리지 않는다
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
