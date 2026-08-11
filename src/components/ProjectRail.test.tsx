// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRail } from './ProjectRail'
import type { ProjectRecord } from '../../shared/projects/projectRecord'

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'p1',
    root: '/tmp/proj',
    name: 'proj',
    favorite: false,
    lastOpenedAt: 1,
    ...overrides,
  }
}

afterEach(cleanup)

describe('프로젝트 레일', () => {
  const RAIL_NOOP = {
    onActivate: () => {},
    onPick: () => {},
    statusOf: () => 'ready' as const,
    onSearchFiles: () => {},
    onClose: () => {},
    onRename: () => {},
    menu: { onSettings: () => {}, onLogs: () => {}, onFeedback: () => {} },
  }

  it('열린 프로젝트마다 칩을 그린다', () => {
    render(
      <ProjectRail
        {...RAIL_NOOP}
        open={[project(), project({ id: 'p2', name: 'other' })]}
        activeId="p1"
      />,
    )

    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  // 칩에는 머리글자 두 자뿐이다 — 이름은 읽어 주기 위해서라도 마크업에 있어야 한다
  it('칩에 머리글자를 그리고, 이름은 읽어 줄 수 있게 남긴다', () => {
    render(<ProjectRail {...RAIL_NOOP} open={[project({ name: 'davis-code-desktop' })]} activeId="p1" />)

    expect(screen.getByText('DC')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /davis-code-desktop/ })).toBeTruthy()
  })

  // 앞 두 글자로는 안 갈린다 — 실제로 이런 이름을 나란히 연다
  it('앞이 겹치는 이름도 머리글자로 갈린다', () => {
    render(
      <ProjectRail
        {...RAIL_NOOP}
        open={[
          project({ id: 'p1', name: 'davis-backend-tobe' }),
          project({ id: 'p2', name: 'davis-code-desktop' }),
        ]}
        activeId="p1"
      />,
    )

    expect(screen.getByText('DB')).toBeTruthy()
    expect(screen.getByText('DC')).toBeTruthy()
  })

  // 나란히 열린 둘이 같은 색이면 색이 표식 노릇을 못 한다
  it('나란히 열린 칩은 서로 다른 색을 받는다', () => {
    render(
      <ProjectRail
        {...RAIL_NOOP}
        open={[
          project({ id: 'p1', name: 'davis-backend-tobe' }),
          project({ id: 'p2', name: 'docs' }),
        ]}
        activeId="p1"
      />,
    )

    // 색은 배지 배경으로 간다 — 칩 글자색이 아니다
    const badges = document.querySelectorAll<HTMLElement>('.project-chip__badge')
    expect(badges).toHaveLength(2)
    expect(badges[0]!.style.background).not.toBe('')
    expect(badges[0]!.style.background).not.toBe(badges[1]!.style.background)
  })

  it('활성 칩만 selected 로 표시한다', () => {
    render(
      <ProjectRail
        {...RAIL_NOOP}
        open={[project(), project({ id: 'p2', name: 'other' })]}
        activeId="p2"
      />,
    )

    const [first, second] = screen.getAllByRole('tab')
    expect(first!.getAttribute('aria-selected')).toBe('false')
    expect(second!.getAttribute('aria-selected')).toBe('true')
  })

  it('칩을 누르면 그 프로젝트로 전환한다', () => {
    const onActivate = vi.fn()
    render(
      <ProjectRail
        {...RAIL_NOOP}
        onActivate={onActivate}
        open={[project(), project({ id: 'p2', name: 'other' })]}
        activeId="p1"
      />,
    )

    fireEvent.click(screen.getAllByRole('tab')[1]!)

    expect(onActivate).toHaveBeenCalledWith('p2')
  })

  // 파일 검색·설정은 앱 전역이라 프로젝트·파일보다 위층이다 — 그래서 이 줄 오른쪽 끝에 있다
  it('오른쪽 끝에 파일 검색과 설정이 있다', () => {
    render(<ProjectRail {...RAIL_NOOP} open={[project()]} activeId="p1" />)

    expect(screen.getByRole('button', { name: '파일 검색' })).toBeTruthy()
    // ⚙ 는 AppMenu 가 그린다 — 이름은 그쪽이 정하므로 펼침 상태로 찾는다
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()
  })

  it('파일 검색을 누르면 빠른 열기를 연다', () => {
    const onSearchFiles = vi.fn()
    render(
      <ProjectRail {...RAIL_NOOP} onSearchFiles={onSearchFiles} open={[project()]} activeId="p1" />,
    )

    fireEvent.click(screen.getByRole('button', { name: '파일 검색' }))

    expect(onSearchFiles).toHaveBeenCalledTimes(1)
  })

  it('+ 는 열기 요청을 올려보낸다', () => {
    const onPick = vi.fn()
    render(<ProjectRail {...RAIL_NOOP} onPick={onPick} open={[project()]} activeId="p1" />)

    fireEvent.click(screen.getByRole('button', { name: /프로젝트 열기/ }))

    expect(onPick).toHaveBeenCalledTimes(1)
  })

  // 비활성 프로젝트도 자기 진행 상황을 알려야 한다 (설계 §5)
  it('비활성 칩도 자기 상태를 보여준다', () => {
    render(
      <ProjectRail
        {...RAIL_NOOP}
        statusOf={(id) => (id === 'p2' ? 'busy' : 'ready')}
        open={[project(), project({ id: 'p2', name: 'other' })]}
        activeId="p1"
      />,
    )

    expect(screen.getByLabelText('작업 중')).toBeTruthy()
  })
})

// 이름이 아래 탭줄에도 있던 시절엔 그쪽에서 했다. 이름이 여기만 남으면서 함께 옮겨왔다
describe('칩에서 이름 고치기·닫기', () => {
  const NOOP = {
    onActivate: () => {},
    onPick: () => {},
    statusOf: () => 'ready' as const,
    onSearchFiles: () => {},
    onClose: () => {},
    onRename: () => {},
    menu: { onSettings: () => {}, onLogs: () => {}, onFeedback: () => {} },
  }

  it('이름을 두 번 누르면 제자리에서 고친다', () => {
    const onRename = vi.fn()
    render(<ProjectRail {...NOOP} onRename={onRename} open={[project()]} activeId="p1" />)

    fireEvent.doubleClick(screen.getByRole('tab', { name: 'proj' }))
    const input = screen.getByLabelText('프로젝트 이름')
    fireEvent.change(input, { target: { value: '새이름' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRename).toHaveBeenCalledWith('p1', '새이름')
  })

  it('Escape 는 이름 변경을 버린다', () => {
    const onRename = vi.fn()
    render(<ProjectRail {...NOOP} onRename={onRename} open={[project()]} activeId="p1" />)

    fireEvent.doubleClick(screen.getByRole('tab', { name: 'proj' }))
    const input = screen.getByLabelText('프로젝트 이름')
    fireEvent.change(input, { target: { value: '버릴것' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'proj' })).toBeTruthy()
  })

  it('빈 이름은 넘기지 않는다', () => {
    const onRename = vi.fn()
    render(<ProjectRail {...NOOP} onRename={onRename} open={[project()]} activeId="p1" />)

    fireEvent.doubleClick(screen.getByRole('tab', { name: 'proj' }))
    const input = screen.getByLabelText('프로젝트 이름')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRename).not.toHaveBeenCalled()
  })

  it('× 는 전환이 아니라 닫기다', () => {
    const onClose = vi.fn()
    const onActivate = vi.fn()
    render(
      <ProjectRail {...NOOP} onClose={onClose} onActivate={onActivate} open={[project()]} activeId="p1" />,
    )

    fireEvent.click(screen.getByRole('button', { name: '닫기 proj' }))

    expect(onClose).toHaveBeenCalledWith('p1')
    expect(onActivate).not.toHaveBeenCalled()
  })
})
