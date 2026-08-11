// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FileTree } from './FileTree'
import { buildBadges } from '../state/gitBadge'
import { EMPTY_GIT_STATE } from '../../shared/git/gitState'

afterEach(cleanup)

const NOOP = { onOpenFile: () => {}, onPickFile: () => {} }

function tree() {
  return {
    children: {
      '': [
        { name: 'a.ts', path: 'a.ts', isDirectory: false },
        { name: 'b.ts', path: 'b.ts', isDirectory: false },
        { name: 'src', path: 'src', isDirectory: true },
      ],
    },
    expanded: new Set<string>(),
    loading: new Set<string>(),
    toggle: () => {},
  }
}

describe('파일 트리 git 배지', () => {
  // 트리는 git 없이도 전과 똑같이 그려져야 한다
  it('git 상태를 주지 않으면 배지가 없다', () => {
    const { container } = render(<FileTree {...NOOP} tree={tree()} />)

    expect(container.querySelectorAll('.dc-tree__badge')).toHaveLength(0)
    expect(screen.getByText('a.ts')).toBeTruthy()
  })

  it('바뀐 파일에만 상태 글자가 붙는다', () => {
    const badges = buildBadges({
      ...EMPTY_GIT_STATE,
      isRepo: true,
      unstaged: [{ path: 'a.ts', status: 'modified' }],
    })
    const { container } = render(<FileTree {...NOOP} tree={tree()} badges={badges} />)

    expect(container.querySelectorAll('.dc-tree__badge--modified')).toHaveLength(1)
    expect(screen.getByText('M')).toBeTruthy()
  })

  it('하위에 변경이 있는 폴더에는 점이 찍힌다', () => {
    const badges = buildBadges({
      ...EMPTY_GIT_STATE,
      isRepo: true,
      unstaged: [{ path: 'src/deep/x.ts', status: 'untracked' }],
    })
    const { container } = render(<FileTree {...NOOP} tree={tree()} badges={badges} />)

    expect(container.querySelectorAll('.dc-tree__badge--dir')).toHaveLength(1)
  })

  it('하위에 변경이 없는 폴더에는 아무것도 없다', () => {
    const badges = buildBadges({
      ...EMPTY_GIT_STATE,
      isRepo: true,
      unstaged: [{ path: 'a.ts', status: 'modified' }],
    })
    const { container } = render(<FileTree {...NOOP} tree={tree()} badges={badges} />)

    expect(container.querySelectorAll('.dc-tree__badge--dir')).toHaveLength(0)
  })
})
