import { describe, expect, it } from 'vitest'
import {
  addPane,
  belongsToPane,
  initialTabs,
  removePane,
  selectPane,
  SHELL_PANE,
  tabLabel,
} from './drawerTabs'

// 드로어 탭의 순수 규칙. **탭 하나가 pty 하나**라 여기서 이름을 잘못 지으면 그대로
// 서버의 pty 제목이 되고(`paneServerTitle`), 되찾기가 어긋난다.

describe('drawerTabs', () => {
  it('처음에는 셸 하나뿐이고 그걸 보고 있다', () => {
    expect(initialTabs).toEqual({ names: [SHELL_PANE], active: SHELL_PANE })
  })

  it('새 칸을 열면 그리로 옮겨 간다 — 열어 놓고 안 보여 주면 연 줄을 모른다', () => {
    const tabs = addPane(initialTabs)

    expect(tabs.names).toEqual([SHELL_PANE, 'shell-2'])
    expect(tabs.active).toBe('shell-2')
  })

  // 이름은 서버의 pty 제목이 되므로 눈에 보이는 값이다 — 열고 닫기를 반복해도 자라면 안 된다
  it('닫아서 빈 번호를 다시 쓴다', () => {
    const three = addPane(addPane(initialTabs))
    expect(three.names).toEqual([SHELL_PANE, 'shell-2', 'shell-3'])

    const closed = removePane(three, 'shell-2')
    expect(addPane(closed).names).toEqual([SHELL_PANE, 'shell-3', 'shell-2'])
  })

  // 셸 칸은 드로어 자신이다. ✕ 로 없앨 수 있으면 돌아갈 길이 사라진다.
  it('셸 칸은 닫히지 않는다', () => {
    expect(removePane(initialTabs, SHELL_PANE)).toEqual(initialTabs)
  })

  it('보고 있던 탭을 닫으면 왼쪽으로 간다', () => {
    const three = addPane(addPane(initialTabs))

    expect(removePane(three, 'shell-3').active).toBe('shell-2')
    expect(removePane(three, 'shell-2').active).toBe('shell-3')
  })

  // 왼쪽으로 가는 이유가 이것이다 — 셸이 맨 앞이라 갈 곳이 언제나 있다
  it('마지막 탭을 닫아도 갈 곳이 있다', () => {
    expect(removePane(addPane(initialTabs), 'shell-2').active).toBe(SHELL_PANE)
  })

  it('안 보고 있던 탭을 닫으면 보던 것이 그대로다', () => {
    const three = selectPane(addPane(addPane(initialTabs)), SHELL_PANE)

    expect(removePane(three, 'shell-2').active).toBe(SHELL_PANE)
  })

  it('없는 이름은 고르지 않는다', () => {
    expect(selectPane(initialTabs, 'shell-9')).toEqual(initialTabs)
  })

  // 「이 프레임은 누구 것인가」. `DrawerTerminal` 은 진짜 xterm 이 필요해 렌더 시험이 없어,
  // 이 판정이 잠기는 곳은 여기 하나다. 축 둘이 각각 도는지를 본다.
  describe('belongsToPane', () => {
    const pane = { projectId: 'A', name: 'shell' }

    it('내 프로젝트, 내 칸이면 받는다', () => {
      expect(belongsToPane({ name: 'shell' }, 'A', pane)).toBe(true)
    })

    // 프로젝트를 옮기는 순간 도착한 이전 프로젝트의 출력이 이 화면에 섞이면 안 된다
    it('남의 프로젝트 것은 안 받는다', () => {
      expect(belongsToPane({ name: 'shell' }, 'B', pane)).toBe(false)
    })

    // 이름을 안 거르면 개발 서버 로그가 셸 화면에 함께 찍힌다 — 칸이 여럿이 되며 생긴 축이다
    it('같은 프로젝트라도 다른 칸 것은 안 받는다', () => {
      expect(belongsToPane({ name: 'dev' }, 'A', pane)).toBe(false)
    })
  })

  // 이름(`shell-2`)은 pty 를 잇는 열쇠지 사람에게 보일 글이 아니다.
  // 다음 회차의 `run_project` 는 AGENTS.md 에서 온 이름을 쓰므로 그대로 보인다.
  it('화면 이름은 셸 계열만 번역한다', () => {
    expect(tabLabel(SHELL_PANE)).toBe('셸')
    expect(tabLabel('shell-2')).toBe('셸 2')
    expect(tabLabel('dev')).toBe('dev')
  })
})
