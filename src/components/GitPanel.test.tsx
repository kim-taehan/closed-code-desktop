// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitPanel } from './GitPanel'
import type { GitBranchMenu } from './GitBranchChip'
import { EMPTY_GIT_STATE, type GitState } from '../../shared/git/gitState'

afterEach(cleanup)

const NOOP = {
  loading: false,
  onRefresh: () => {},
  onOpenDiff: () => {},
  onToggle: () => {},
  onRevert: () => {},
  onPull: () => {},
  onCommit: () => {},
  onPush: () => {},
}

function state(overrides: Partial<GitState> = {}): GitState {
  return { ...EMPTY_GIT_STATE, isRepo: true, branch: 'main', ...overrides }
}

/** 브랜치 칩 메뉴 — 지금 브랜치(main)와 옮겨 갈 곳 하나 */
function branchMenu(): GitBranchMenu {
  return {
    branches: [
      { name: 'main', remote: false, date: '', track: '', current: true },
      { name: 'feat/x', remote: false, date: '', track: '', current: false },
    ],
    busy: false,
    onSwitch: vi.fn(),
    onCreate: vi.fn(),
  }
}

/** 묶음 머리에서 개수만 집는다 (제목 옆 버튼 글자에 흔들리지 않게) */
function count(title: string): string | undefined {
  return screen.getByText(title).querySelector('.git-group__count')?.textContent ?? undefined
}

describe('소스 관리 패널', () => {
  // 메뉴 항목은 남기고 본문에서 이유를 밝힌다 (설계 §2) — 감추면 왜 없는지 찾게 된다
  it('저장소가 아니면 이유를 한 줄로 알린다', () => {
    render(<GitPanel {...NOOP} state={EMPTY_GIT_STATE} />)

    expect(screen.getByText('git 저장소가 아닙니다.')).toBeTruthy()
  })

  it('git 을 못 돌리면 사유를 그대로 보여준다', () => {
    render(<GitPanel {...NOOP} state={state({ error: 'git 을 찾을 수 없습니다' })} />)

    expect(screen.getByText('git 을 찾을 수 없습니다')).toBeTruthy()
  })

  it('두 묶음을 제목과 개수로 나눈다', () => {
    render(
      <GitPanel
        {...NOOP}
        state={state({
          staged: [{ path: 'a.ts', status: 'modified' }],
          unstaged: [
            { path: 'b.ts', status: 'modified' },
            { path: 'c.ts', status: 'untracked' },
          ],
        })}
      />,
    )

    // 개수만 따로 집는다 — 묶음 머리에 액션 버튼이 붙으면서 textContent 에 버튼
    // 글자가 섞인다. 잠그려던 것은 "제목 옆에 그 묶음의 개수가 붙는다" 였다.
    expect(count('스테이지됨')).toBe('1')
    expect(count('변경사항')).toBe('2')
  })

  // git 이 실제로 양쪽에 두는 상태다. 억지로 한쪽에 몰면 사실과 어긋난다.
  it('담은 뒤 또 고친 파일은 양쪽에 나오고 이유가 붙는다', () => {
    render(
      <GitPanel
        {...NOOP}
        state={state({
          staged: [{ path: 'a.ts', status: 'modified' }],
          unstaged: [{ path: 'a.ts', status: 'modified' }],
        })}
      />,
    )

    expect(screen.getAllByText('a.ts')).toHaveLength(2)
    expect(screen.getByText('담은 뒤 또 고침')).toBeTruthy()
    expect(screen.getByText('일부만 담김')).toBeTruthy()
  })

  it('변경이 없으면 그렇다고 말한다', () => {
    render(<GitPanel {...NOOP} state={state()} />)

    expect(screen.getByText('변경된 파일이 없습니다.')).toBeTruthy()
  })

  // 늘 붙어 있으면 눈이 무시하게 된다
  it('ahead·behind 가 0이면 화살표를 그리지 않는다', () => {
    render(<GitPanel {...NOOP} state={state({ upstream: 'origin/main' })} />)

    expect(screen.queryByText(/↑/)).toBeNull()
    expect(screen.queryByText(/↓/)).toBeNull()
  })

  it('앞서거나 뒤처지면 그 수만 보여준다', () => {
    render(<GitPanel {...NOOP} state={state({ upstream: 'origin/main', ahead: 2, behind: 3 })} />)

    expect(screen.getByText('↑2')).toBeTruthy()
    expect(screen.getByText('↓3')).toBeTruthy()
  })

  it('업스트림이 없으면 화살표 대신 이유를 적는다', () => {
    render(<GitPanel {...NOOP} state={state({ ahead: 5 })} />)

    expect(screen.getByText('origin 없음')).toBeTruthy()
    expect(screen.queryByText('↑5')).toBeNull()
  })

  // 같은 파일이라도 어느 묶음에서 눌렀는지에 따라 보여줄 것이 다르다 (설계 §4)
  it('파일을 누르면 어느 묶음에서 눌렀는지와 함께 알린다', () => {
    const onOpenDiff = vi.fn()
    render(
      <GitPanel
        {...NOOP}
        onOpenDiff={onOpenDiff}
        state={state({
          staged: [{ path: 'a.ts', status: 'modified' }],
          unstaged: [{ path: 'b.ts', status: 'modified' }],
        })}
      />,
    )

    fireEvent.click(screen.getByText('a.ts'))
    expect(onOpenDiff).toHaveBeenCalledWith('a.ts', true)

    fireEvent.click(screen.getByText('b.ts'))
    expect(onOpenDiff).toHaveBeenCalledWith('b.ts', false)
  })

  // 이 패널의 규칙 — 아직 채널이 없는 행동은 자리를 비운다. 회색 버튼도 남기지 않는다.
  it('묶음 액션 콜백을 안 주면 버튼 자체가 없다', () => {
    render(
      <GitPanel
        {...NOOP}
        state={state({
          staged: [{ path: 'a.ts', status: 'modified' }],
          unstaged: [{ path: 'b.ts', status: 'modified' }],
        })}
      />,
    )

    expect(screen.queryByText('모두 담기')).toBeNull()
    expect(screen.queryByText('모두 취소')).toBeNull()
    expect(screen.queryByText('전체 화면에서 보기 →')).toBeNull()
  })

  it('묶음 액션은 제 묶음에만 붙는다', () => {
    const onStageAll = vi.fn()
    const onUnstageAll = vi.fn()
    render(
      <GitPanel
        {...NOOP}
        onStageAll={onStageAll}
        onUnstageAll={onUnstageAll}
        state={state({
          staged: [{ path: 'a.ts', status: 'modified' }],
          unstaged: [{ path: 'b.ts', status: 'modified' }],
        })}
      />,
    )

    // 담긴 묶음에서는 취소만, 안 담긴 묶음에서는 담기만 할 수 있다
    fireEvent.click(screen.getByText('모두 취소'))
    expect(onUnstageAll).toHaveBeenCalledTimes(1)
    expect(onStageAll).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('모두 담기'))
    expect(onStageAll).toHaveBeenCalledTimes(1)
  })

  it('전체 화면 버튼은 콜백을 준 때만 뜬다', () => {
    const onOpenScm = vi.fn()
    render(<GitPanel {...NOOP} onOpenScm={onOpenScm} state={state()} />)

    fireEvent.click(screen.getByText('전체 화면에서 보기 →'))
    expect(onOpenScm).toHaveBeenCalledTimes(1)
  })

  // 🔴 이 자리를 보는 단언이 하나도 없어서 결함이 게이트를 통과했다 (QA D6):
  //    1단계에 "채널이 없다"고 뺀 캐럿이 3단계에 채널이 생긴 뒤에도 그대로였고,
  //    사이드바 칩은 눌러도 아무 일이 없었다. 같은 구멍을 다시 열지 않는다.
  it('메뉴를 안 주면 칩에 누를 것이 없다', () => {
    const { container } = render(<GitPanel {...NOOP} state={state()} />)

    expect(container.querySelector('.git-chip__toggle')).toBeNull()
    expect(container.textContent).not.toContain('▾')
  })

  it('메뉴를 주면 칩을 눌러 다른 브랜치로 옮길 수 있다', () => {
    const menu = branchMenu()
    render(<GitPanel {...NOOP} branchMenu={menu} state={state()} />)

    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'feat/x' }))

    expect(menu.onSwitch).toHaveBeenCalledWith('feat/x')
  })

  it('메뉴를 주면 칩에서 새 브랜치를 만들 수 있다', () => {
    const menu = branchMenu()
    render(<GitPanel {...NOOP} branchMenu={menu} state={state()} />)

    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    fireEvent.click(screen.getByText('+ 새 브랜치'))
    fireEvent.change(screen.getByLabelText('새 브랜치 이름'), { target: { value: 'feat/y' } })
    fireEvent.submit(screen.getByLabelText('새 브랜치 이름'))

    expect(menu.onCreate).toHaveBeenCalledWith('feat/y')
  })

  it('목록이 아주 길면 자르되 몇 개가 빠졌는지 알린다', () => {
    const many = Array.from({ length: 205 }, (_, index) => ({
      path: `file-${index}.ts`,
      status: 'modified' as const,
    }))
    render(<GitPanel {...NOOP} state={state({ unstaged: many })} />)

    expect(screen.getByText('외 5개')).toBeTruthy()
  })
})
