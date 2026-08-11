// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScmFileList } from './ScmFileList'
import type { GitFileEntry, GitState } from '../../shared/git/gitState'

// 목록은 사이드바와 같은 것(`GitGroup`·`GitFileRow`)을 그린다. 여기서 새로 생긴 것은
// 거르기 칸 하나뿐이라 그것과 빈 상태만 잠근다.

afterEach(cleanup)

function entry(path: string): GitFileEntry {
  return { path, status: 'modified' }
}

function state(patch: Partial<GitState> = {}): GitState {
  return {
    isRepo: true,
    branch: 'main',
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [entry('src/App.tsx'), entry('electron/main.ts')],
    ...patch,
  }
}

const NOOP = {
  loading: false,
  onSelect: () => {},
  onToggle: () => {},
  onRevert: () => {},
}

function paths(): string[] {
  return screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label') ?? '')
}

describe('거르기', () => {
  it('이름이 이어서 나오면 남긴다 (퍼지) — 빈 칸이면 전부 남는다', () => {
    render(<ScmFileList {...NOOP} state={state()} />)
    expect(paths()).toEqual(['src/App.tsx', 'electron/main.ts'])

    fireEvent.change(screen.getByLabelText('파일 이름으로 거르기'), { target: { value: 'app' } })

    expect(paths()).toEqual(['src/App.tsx'])
  })

  // 글자를 한 자 칠 때마다 남은 줄이 위아래로 튀면 눈이 따라가지 못한다
  it('점수로 다시 줄 세우지 않는다 — git 이 준 순서 그대로', () => {
    render(
      <ScmFileList
        {...NOOP}
        state={state({ unstaged: [entry('z/t.ts'), entry('t.ts'), entry('a/t.ts')] })}
      />,
    )

    fireEvent.change(screen.getByLabelText('파일 이름으로 거르기'), { target: { value: 't' } })

    expect(paths()).toEqual(['z/t.ts', 't.ts', 'a/t.ts'])
  })

  it('아무것도 안 남으면 변경이 없는 것과 다르게 말한다', () => {
    render(<ScmFileList {...NOOP} state={state()} />)

    fireEvent.change(screen.getByLabelText('파일 이름으로 거르기'), { target: { value: 'zzz' } })

    expect(screen.getByText('거른 조건에 맞는 파일이 없습니다.')).toBeTruthy()
    expect(screen.queryByText('변경된 파일이 없습니다.')).toBeNull()
  })
})

describe('빈 상태 · 묶음 행동', () => {
  it('변경이 없으면 사이드바와 같은 문구를 쓴다', () => {
    render(<ScmFileList {...NOOP} state={state({ staged: [], unstaged: [] })} />)

    expect(screen.getByText('변경된 파일이 없습니다.')).toBeTruthy()
  })

  // GitGroup 규칙 그대로 — 채널 없는 행동을 회색 버튼으로 앉혀 두지 않는다
  it('묶음 행동은 콜백을 줬을 때만 그린다', () => {
    const onStageAll = vi.fn()
    const { rerender } = render(<ScmFileList {...NOOP} state={state()} />)
    expect(screen.queryByText('모두 담기')).toBeNull()

    rerender(<ScmFileList {...NOOP} state={state()} onStageAll={onStageAll} />)
    fireEvent.click(screen.getByText('모두 담기'))

    expect(onStageAll).toHaveBeenCalledTimes(1)
  })

  it('파일 이름을 누르면 어느 묶음에서 눌렀는지까지 알린다', () => {
    const onSelect = vi.fn()
    render(
      <ScmFileList
        {...NOOP}
        onSelect={onSelect}
        state={state({ staged: [entry('a.ts')], unstaged: [entry('b.ts')] })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'a.ts' }))
    expect(onSelect).toHaveBeenCalledWith('a.ts', true)

    fireEvent.click(screen.getByRole('button', { name: 'b.ts' }))
    expect(onSelect).toHaveBeenCalledWith('b.ts', false)
  })
})
