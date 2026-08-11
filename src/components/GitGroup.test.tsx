// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitGroup } from './GitGroup'
import type { GitFileEntry } from '../../shared/git/gitState'

afterEach(cleanup)

const NOOP = {
  staged: false,
  bothSides: new Set<string>(),
  onOpenDiff: () => {},
  onToggle: () => {},
  onRevert: () => {},
}

const ONE: GitFileEntry[] = [{ path: 'a.ts', status: 'modified' }]

describe('git 묶음', () => {
  it('빈 묶음은 제목도 그리지 않는다', () => {
    const { container } = render(<GitGroup {...NOOP} title="변경사항" entries={[]} />)

    expect(container.firstChild).toBeNull()
  })

  // 이 패널의 규칙 — 아직 채널이 없는 행동은 회색 버튼으로도 남기지 않는다
  it('행동을 안 주면 머리에 버튼이 없다', () => {
    const { container } = render(<GitGroup {...NOOP} title="변경사항" entries={ONE} />)

    expect(container.querySelector('.git-group__action')).toBeNull()
  })

  it('행동을 주면 누를 수 있다', () => {
    const onClick = vi.fn()
    render(
      <GitGroup {...NOOP} title="변경사항" entries={ONE} action={{ label: '모두 담기', onClick }} />,
    )

    fireEvent.click(screen.getByText('모두 담기'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('막아 두면 눌러도 안 불린다', () => {
    const onClick = vi.fn()
    render(
      <GitGroup
        {...NOOP}
        title="변경사항"
        entries={ONE}
        action={{ label: '모두 담기', onClick, disabled: true }}
      />,
    )

    fireEvent.click(screen.getByText('모두 담기'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('목록이 아주 길면 자르되 몇 개가 빠졌는지 알린다', () => {
    const many = Array.from({ length: 203 }, (_, index) => ({
      path: `file-${index}.ts`,
      status: 'modified' as const,
    }))
    render(<GitGroup {...NOOP} title="변경사항" entries={many} />)

    expect(screen.getByText('외 3개')).toBeTruthy()
  })

  it('반대쪽에도 있는 파일에는 이유가 붙는다', () => {
    render(
      <GitGroup {...NOOP} title="변경사항" entries={ONE} bothSides={new Set(['a.ts'])} />,
    )

    expect(screen.getByText('일부만 담김')).toBeTruthy()
  })
})
