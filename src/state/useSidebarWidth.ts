import { useCallback, useEffect, useRef, useState } from 'react'

// 사이드바 폭. 끌어서 바꾸고 다음에 열 때도 그대로 둔다.
//
// 앱 설정(서버·라이선스)과 섞지 않는다 — 이건 이 컴퓨터의 화면 취향일 뿐이라
// localStorage 로 충분하다. 값 하나 때문에 설정 스토어를 거칠 이유가 없다.

const KEY = 'davis.sidebarWidth'
const MIN = 200
const MAX = 560
const DEFAULT = 320

export interface SidebarWidth {
  width: number
  /** 손잡이에 onMouseDown 으로 건다 */
  startDrag: (event: React.MouseEvent) => void
  dragging: boolean
}

export function useSidebarWidth(): SidebarWidth {
  const [width, setWidth] = useState(load)
  const [dragging, setDragging] = useState(false)
  // 드래그 중 상태 갱신마다 리스너를 다시 걸지 않으려고 ref 로 최신 폭을 든다
  const latest = useRef(width)

  const startDrag = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return

    const onMove = (event: MouseEvent) => {
      // 사이드바는 왼쪽에 붙어 있으므로 커서의 x 가 곧 폭이다
      const next = clamp(event.clientX)
      latest.current = next
      setWidth(next)
    }
    const onUp = () => {
      setDragging(false)
      localStorage.setItem(KEY, String(latest.current))
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  return { width, startDrag, dragging }
}

function clamp(value: number): number {
  return Math.max(MIN, Math.min(MAX, value))
}

function load(): number {
  const raw = Number(localStorage.getItem(KEY))
  return Number.isFinite(raw) && raw > 0 ? clamp(raw) : DEFAULT
}
