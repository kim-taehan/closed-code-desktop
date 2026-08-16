// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { SHELL_PANE } from './drawerTabs'
import { useShellDrawer } from './useShellDrawer'

const KEY = 'davis.shellDrawerHeight'

const closeShellPane = vi.fn()

beforeEach(() => {
  localStorage.clear()
  closeShellPane.mockClear()
  window.davis = { closeShellPane } as never
})

describe('useShellDrawer', () => {
  // 앱을 켜면 먼저 보고 싶은 것은 대화지 지난번에 열어 둔 셸이 아니다
  it('처음에는 접혀 있고 셸을 띄우지도 않는다', () => {
    const { result } = renderHook(() => useShellDrawer('A'))
    expect(result.current.open).toBe(false)
    expect(result.current.everOpened).toBe(false)
    expect(result.current.focus).toBe('main')
  })

  it('⌘↓ 는 펴면서 포커스를 셸로 내린다', () => {
    const { result } = renderHook(() => useShellDrawer('A'))
    act(() => result.current.goDown())

    expect(result.current.open).toBe(true)
    expect(result.current.focus).toBe('drawer')
  })

  it('⌘↑ 는 접으면서 포커스를 본문으로 올린다', () => {
    const { result } = renderHook(() => useShellDrawer('A'))
    act(() => result.current.goDown())
    act(() => result.current.goUp())

    expect(result.current.open).toBe(false)
    expect(result.current.focus).toBe('main')
  })

  // **접어도 everOpened 는 남는다.** 이게 남지 않으면 다시 펼 때 셸을 새로 띄우게 되고,
  // 서버가 들고 있던 스크롤백으로 돌아갈 길이 없어진다.
  it('한 번 열면 접어도 열었던 사실은 남는다', () => {
    const { result } = renderHook(() => useShellDrawer('A'))
    act(() => result.current.goDown())
    act(() => result.current.goUp())

    expect(result.current.everOpened).toBe(true)
  })

  it('접혀 있어도 높이는 기억한다 — 0 으로 두면 돌아갈 자리를 잃는다', () => {
    const { result } = renderHook(() => useShellDrawer('A'))
    const height = result.current.height
    act(() => result.current.goDown())
    act(() => result.current.goUp())

    expect(result.current.height).toBe(height)
  })

  describe('높이 기억', () => {
    it('저장된 값을 읽는다', () => {
      localStorage.setItem(KEY, '300')
      expect(renderHook(() => useShellDrawer('A')).result.current.height).toBe(300)
    })

    it('상한(720)·하한(80) 밖의 값은 잘라 낸다', () => {
      localStorage.setItem(KEY, '5000')
      expect(renderHook(() => useShellDrawer('A')).result.current.height).toBe(720)

      localStorage.setItem(KEY, '3')
      expect(renderHook(() => useShellDrawer('A')).result.current.height).toBe(80)
    })

    it('모르는 값은 기본값으로 돌린다', () => {
      localStorage.setItem(KEY, '망가진 값')
      // 칸이 입력창 아래 맨 밑으로 내려가면서 기본값을 줄였다 (220 → 160)
      expect(renderHook(() => useShellDrawer('A')).result.current.height).toBe(160)
    })
  })

  describe('드래그', () => {
    // 칸은 **화면 맨 아래**에 붙어 있으므로 바닥에서 커서까지의 거리가 곧 높이다
    // (칸 밑에 입력창이 있던 시절에는 이 계산이 그 높이만큼 어긋났다)
    it('마우스를 올리면 높이가 늘고, 손을 떼면 저장한다', () => {
      window.innerHeight = 800
      const { result } = renderHook(() => useShellDrawer('A'))
      act(() => result.current.goDown())
      act(() => result.current.startDrag({ preventDefault: () => {} } as React.MouseEvent))

      act(() => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientY: 500 }))
      })
      expect(result.current.height).toBe(300)

      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup'))
      })
      expect(result.current.dragging).toBe(false)
      expect(localStorage.getItem(KEY)).toBe('300')
    })

    // 접힌 채로는 끌 손잡이가 없다 — 안 끊으면 마우스를 떼는 자리에서
    // 엉뚱한 높이가 저장된다.
    it('접으면 드래그가 끊긴다', () => {
      const { result } = renderHook(() => useShellDrawer('A'))
      act(() => result.current.goDown())
      act(() => result.current.startDrag({ preventDefault: () => {} } as React.MouseEvent))
      expect(result.current.dragging).toBe(true)

      act(() => result.current.close())
      expect(result.current.dragging).toBe(false)
    })
  })

  // 탭 목록만 프로젝트마다 따로다. 앱 하나로 두면 A 에서 셸을 셋 열고 B 로 옮기는 순간
  // **B 의 서버에 셸 셋이 저절로 뜬다** — 칸 하나가 pty 하나이기 때문이다.
  describe('탭', () => {
    it('처음에는 셸 칸 하나뿐이다', () => {
      const { result } = renderHook(() => useShellDrawer('A'))
      expect(result.current.tabs.names).toEqual([SHELL_PANE])
    })

    it('프로젝트마다 따로 센다', () => {
      const { result, rerender } = renderHook((id: string) => useShellDrawer(id), {
        initialProps: 'A',
      })
      act(() => result.current.addTab())
      expect(result.current.tabs.names).toHaveLength(2)

      rerender('B')
      expect(result.current.tabs.names).toEqual([SHELL_PANE])

      // 옮겼다 돌아오면 그대로다 — 프로세스는 살아 있는데 탭이 사라지면
      // "탭이 없어졌으니 서버도 죽은 줄" 로 읽힌다 (설계 §1)
      rerender('A')
      expect(result.current.tabs.names).toHaveLength(2)
    })

    // 탭을 눌렀는데 칸이 접혀 있거나 키가 본문으로 가면 방금 고른 칸이 아무 반응도 안 한다
    it('탭 조작은 고르면서 편다', () => {
      const { result } = renderHook(() => useShellDrawer('A'))
      act(() => result.current.addTab())

      expect(result.current.open).toBe(true)
      expect(result.current.focus).toBe('drawer')
      expect(result.current.tabs.active).toBe('shell-2')
    })

    // **이 한 줄이 「탭을 닫으면 프로세스도 멈춘다」의 배선이다.** 화면 쪽만 지우면
    // 띄운 개발 서버가 화면에서만 사라진 채 계속 돈다 (설계 §1 「화면이 지켜야 할 것」).
    it('탭을 닫으면 main 에 프로세스 정리를 시킨다', () => {
      const { result } = renderHook(() => useShellDrawer('A'))
      act(() => result.current.addTab())
      act(() => result.current.closeTab('shell-2'))

      expect(closeShellPane).toHaveBeenCalledWith({ projectId: 'A', name: 'shell-2' })
      expect(result.current.tabs.names).toEqual([SHELL_PANE])
    })

    // `open_terminal`(MCP)이 쓰는 문. 채워 둔 명령이 들어가는 곳이 셸 칸이라
    // (`drawerBridge.fill`), 다른 탭을 보고 있으면 사용자는 채워진 줄을 못 본다
    it('showShell 은 셸 칸을 앞에 놓고 편다', () => {
      const { result } = renderHook(() => useShellDrawer('A'))
      act(() => result.current.addTab())
      act(() => result.current.goUp())

      act(() => result.current.showShell())
      expect(result.current.tabs.active).toBe(SHELL_PANE)
      expect(result.current.open).toBe(true)
    })
  })
})
