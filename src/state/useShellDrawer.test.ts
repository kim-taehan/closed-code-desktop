// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useShellDrawer } from './useShellDrawer'

const KEY = 'davis.shellDrawerHeight'

beforeEach(() => {
  localStorage.clear()
})

describe('useShellDrawer', () => {
  // 앱을 켜면 먼저 보고 싶은 것은 대화지 지난번에 열어 둔 셸이 아니다
  it('처음에는 접혀 있고 셸을 띄우지도 않는다', () => {
    const { result } = renderHook(() => useShellDrawer())
    expect(result.current.open).toBe(false)
    expect(result.current.everOpened).toBe(false)
    expect(result.current.focus).toBe('main')
  })

  it('⌘↓ 는 펴면서 포커스를 셸로 내린다', () => {
    const { result } = renderHook(() => useShellDrawer())
    act(() => result.current.goDown())

    expect(result.current.open).toBe(true)
    expect(result.current.focus).toBe('drawer')
  })

  it('⌘↑ 는 접으면서 포커스를 본문으로 올린다', () => {
    const { result } = renderHook(() => useShellDrawer())
    act(() => result.current.goDown())
    act(() => result.current.goUp())

    expect(result.current.open).toBe(false)
    expect(result.current.focus).toBe('main')
  })

  // **접어도 everOpened 는 남는다.** 이게 남지 않으면 다시 펼 때 셸을 새로 띄우게 되고,
  // 서버가 들고 있던 스크롤백으로 돌아갈 길이 없어진다.
  it('한 번 열면 접어도 열었던 사실은 남는다', () => {
    const { result } = renderHook(() => useShellDrawer())
    act(() => result.current.goDown())
    act(() => result.current.goUp())

    expect(result.current.everOpened).toBe(true)
  })

  it('접혀 있어도 높이는 기억한다 — 0 으로 두면 돌아갈 자리를 잃는다', () => {
    const { result } = renderHook(() => useShellDrawer())
    const height = result.current.height
    act(() => result.current.goDown())
    act(() => result.current.goUp())

    expect(result.current.height).toBe(height)
  })

  describe('높이 기억', () => {
    it('저장된 값을 읽는다', () => {
      localStorage.setItem(KEY, '300')
      expect(renderHook(() => useShellDrawer()).result.current.height).toBe(300)
    })

    it('상한(720)·하한(80) 밖의 값은 잘라 낸다', () => {
      localStorage.setItem(KEY, '5000')
      expect(renderHook(() => useShellDrawer()).result.current.height).toBe(720)

      localStorage.setItem(KEY, '3')
      expect(renderHook(() => useShellDrawer()).result.current.height).toBe(80)
    })

    it('모르는 값은 기본값으로 돌린다', () => {
      localStorage.setItem(KEY, '망가진 값')
      // 칸이 입력창 아래 맨 밑으로 내려가면서 기본값을 줄였다 (220 → 160)
      expect(renderHook(() => useShellDrawer()).result.current.height).toBe(160)
    })
  })

  describe('드래그', () => {
    // 칸은 **화면 맨 아래**에 붙어 있으므로 바닥에서 커서까지의 거리가 곧 높이다
    // (칸 밑에 입력창이 있던 시절에는 이 계산이 그 높이만큼 어긋났다)
    it('마우스를 올리면 높이가 늘고, 손을 떼면 저장한다', () => {
      window.innerHeight = 800
      const { result } = renderHook(() => useShellDrawer())
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
      const { result } = renderHook(() => useShellDrawer())
      act(() => result.current.goDown())
      act(() => result.current.startDrag({ preventDefault: () => {} } as React.MouseEvent))
      expect(result.current.dragging).toBe(true)

      act(() => result.current.close())
      expect(result.current.dragging).toBe(false)
    })
  })
})
