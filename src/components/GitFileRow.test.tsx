// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitFileRow } from './GitFileRow'
import type { GitFileEntry } from '../../shared/git/gitState'

afterEach(cleanup)

const NOOP = { onOpenDiff: () => {}, onToggle: () => {}, onRevert: () => {} }

function row(entry: GitFileEntry, staged = false, extra = {}) {
  return render(<GitFileRow {...NOOP} {...extra} entry={entry} staged={staged} />)
}

describe('git 파일 한 줄', () => {
  it('체크하면 담기를 부른다', () => {
    const onToggle = vi.fn()
    row({ path: 'a.ts', status: 'modified' }, false, { onToggle })

    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith('a.ts', true)
  })

  it('이미 담긴 것을 누르면 빼기를 부른다', () => {
    const onToggle = vi.fn()
    row({ path: 'a.ts', status: 'modified' }, true, { onToggle })

    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith('a.ts', false)
  })

  // 충돌은 담을 수 없다 — 해결은 터미널에서
  it('충돌 행은 체크가 막힌다', () => {
    row({ path: 'a.ts', status: 'conflicted' })
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true)
  })

  // git 에 이전 내용이 없어 되돌리기가 삭제가 된다 (설계 §4)
  it('추적 안 되는 파일에는 되돌리기가 없다', () => {
    row({ path: 'a.ts', status: 'untracked' })
    expect(screen.queryByTitle('되돌리기')).toBeNull()
  })

  it('충돌 행에도 되돌리기가 없다', () => {
    row({ path: 'a.ts', status: 'conflicted' })
    expect(screen.queryByTitle('되돌리기')).toBeNull()
  })

  it('바뀐 파일은 되돌릴 수 있다', () => {
    const onRevert = vi.fn()
    row({ path: 'a.ts', status: 'modified' }, false, { onRevert })

    fireEvent.click(screen.getByTitle('되돌리기'))
    expect(onRevert).toHaveBeenCalledWith('a.ts')
  })
})

describe('바뀐 줄 수', () => {
  it('추가·삭제를 각각 보여준다', () => {
    row({ path: 'a.ts', status: 'modified', insertions: 41, deletions: 12 })

    expect(screen.getByText('+41')).toBeTruthy()
    expect(screen.getByText('−12')).toBeTruthy()
  })

  // ⚠ 수치가 **없는 것**은 0 이 아니라 "모름"이다 (gitState.GitFileEntry 주석).
  // 바이너리에는 줄 수라는 게 없다 — `+0 −0` 을 그리면 안 바뀐 파일처럼 보인다.
  it('수치를 모르는 파일(바이너리)에는 0 을 지어내지 않는다', () => {
    const { container } = row({ path: 'logo.png', status: 'modified' })

    expect(container.querySelector('.git-row__stat')).toBeNull()
    expect(screen.queryByText(/^[+−]0$/)).toBeNull()
  })

  // 한쪽만 0 인 것은 사실이다 — 그 자리만 비운다 (↑↓ 와 같은 규칙)
  it('0 인 쪽은 그리지 않는다', () => {
    row({ path: 'new.ts', status: 'added', insertions: 88, deletions: 0 })

    expect(screen.getByText('+88')).toBeTruthy()
    expect(screen.queryByText('−0')).toBeNull()
  })
})

describe('충돌 표시', () => {
  it('충돌 지점 개수를 알린다', () => {
    row({ path: 'a.ts', status: 'conflicted', conflictCount: 2 })

    expect(screen.getByText('충돌 2곳')).toBeTruthy()
  })

  it('개수를 못 셌으면 개수 없이 충돌만 알린다', () => {
    row({ path: 'a.ts', status: 'conflicted' })

    expect(screen.getByText('충돌')).toBeTruthy()
    expect(screen.queryByText('충돌 0곳')).toBeNull()
  })
})

describe('경로 표시', () => {
  it('폴더와 파일 이름을 나눠 그린다', () => {
    const { container } = row({ path: 'src/components/GitPanel.tsx', status: 'modified' })

    expect(container.querySelector('.git-row__dir')?.textContent).toBe('src/components/')
    // 나눠 그려도 경로는 한 덩어리로 읽혀야 한다
    expect(container.querySelector('.git-row__path')?.textContent).toBe(
      'src/components/GitPanel.tsx',
    )
  })

  it('루트에 있는 파일에는 폴더 조각을 만들지 않는다', () => {
    const { container } = row({ path: 'README.md', status: 'modified' })

    expect(container.querySelector('.git-row__dir')).toBeNull()
  })
})
