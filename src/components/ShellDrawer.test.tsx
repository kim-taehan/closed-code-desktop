// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShellDrawer } from './ShellDrawer'
import { initialTabs, addPane, SHELL_PANE } from '../state/drawerTabs'
import type { ShellDrawer as DrawerState } from '../state/useShellDrawer'

// **탭이 여럿일 때 키가 어디로 가는가.**
//
// 이 파일이 겨누는 것은 새로 생긴 위험 하나다: 안 보이는 칸도 언마운트하지 않으므로
// (스크롤백을 지키려고) 마운트된 터미널이 **여럿**이다. `active` 를 탭으로 안 가르면
// 전부 `focus()` 를 불러 마지막 것이 이기고, 사용자는 **안 보이는 칸에 타이핑한다** —
// 화면에는 아무 일도 안 일어나는 것으로 보인다.
//
// 진짜 xterm 은 안 세운다 (`drawerKeys.ts` 가 적어 둔 대로 그쪽은 렌더 시험이 없다).
// 여기서 보는 것은 배선이지 터미널이 아니다.

const rendered: { name: string; active: boolean }[] = []

vi.mock('./DrawerTerminal', () => ({
  DrawerTerminal: ({ name, active }: { name: string; active: boolean }) => {
    rendered.push({ name, active })
    return <div data-testid={`term-${name}`} data-active={active} />
  },
}))

afterEach(() => {
  cleanup()
  rendered.length = 0
})

function drawer(over: Partial<DrawerState> = {}): DrawerState {
  return {
    open: true,
    height: 160,
    everOpened: true,
    focus: 'drawer',
    tabs: initialTabs,
    // 종료 코드 표는 「실행」 패널의 점이 쓴다 — 드로어 자신은 안 본다
    exits: { exitOf: () => undefined, clear: () => {} },
    goDown: () => {},
    goUp: () => {},
    close: () => {},
    startDrag: () => {},
    dragging: false,
    selectTab: () => {},
    addTab: () => {},
    closeTab: () => {},
    showShell: () => {},
    showPane: () => {},
    ...over,
  }
}

describe('ShellDrawer — 탭', () => {
  const two = addPane(initialTabs)

  it('탭마다 터미널이 하나씩 산다 — 안 보이는 것도 언마운트하지 않는다', () => {
    render(<ShellDrawer projectId="A" drawer={drawer({ tabs: two })} theme="dark" />)

    expect(screen.getByTestId('term-shell')).toBeTruthy()
    expect(screen.getByTestId('term-shell-2')).toBeTruthy()
  })

  it('키를 받는 칸은 고른 탭 하나뿐이다', () => {
    render(<ShellDrawer projectId="A" drawer={drawer({ tabs: two })} theme="dark" />)

    expect(rendered.filter((pane) => pane.active).map((pane) => pane.name)).toEqual(['shell-2'])
  })

  // 접혀 있으면 아무 칸도 키를 받으면 안 된다 — 안 보이는 칸이 타이핑을 먹는다
  it('접혀 있으면 아무 칸도 키를 안 받는다', () => {
    render(<ShellDrawer projectId="A" drawer={drawer({ tabs: two, open: false })} theme="dark" />)

    expect(rendered.filter((pane) => pane.active)).toEqual([])
  })

  it('포커스가 본문에 있으면 아무 칸도 키를 안 받는다', () => {
    render(<ShellDrawer projectId="A" drawer={drawer({ tabs: two, focus: 'main' })} theme="dark" />)

    expect(rendered.filter((pane) => pane.active)).toEqual([])
  })

  // 셸 칸은 드로어 자신이라 ✕ 가 없다 — 접는 것(⌘↑)과 다른 일이 아니다
  it('셸 칸에는 닫기 단추가 없고 그 밖의 칸에는 있다', () => {
    render(<ShellDrawer projectId="A" drawer={drawer({ tabs: two })} theme="dark" />)

    expect(screen.queryByTitle(/^셸 닫기/)).toBeNull()
    expect(screen.getByTitle('셸 2 닫기 (프로세스도 멈춥니다)')).toBeTruthy()
  })

  it('닫기는 그 칸의 이름으로 부른다', () => {
    const closeTab = vi.fn()
    render(<ShellDrawer projectId="A" drawer={drawer({ tabs: two, closeTab })} theme="dark" />)
    screen.getByTitle('셸 2 닫기 (프로세스도 멈춥니다)').click()

    expect(closeTab).toHaveBeenCalledWith('shell-2')
  })

  it('탭을 누르면 그 이름으로 고른다', () => {
    const selectTab = vi.fn()
    render(<ShellDrawer projectId="A" drawer={drawer({ tabs: two, selectTab })} theme="dark" />)
    screen.getByRole('tab', { name: '셸' }).click()

    expect(selectTab).toHaveBeenCalledWith(SHELL_PANE)
  })

  // 한 번도 편 적 없으면 아예 안 그린다 — 열어 본 적도 없는 프로젝트에 셸이 뜨면 낭비다
  it('편 적 없으면 칸을 그리지 않는다', () => {
    render(<ShellDrawer projectId="A" drawer={drawer({ everOpened: false })} theme="dark" />)

    expect(rendered).toEqual([])
  })
})
