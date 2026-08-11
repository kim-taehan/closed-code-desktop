import { useCallback, useEffect, useRef, useState } from 'react'

// 탭 줄이 넘칠 때의 좌우 이동 (IntelliJ 의 탭 줄 양 끝 화살표).
//
// 스크롤바 대신 화살표를 쓰는 이유: 가로 스크롤바는 탭 줄 높이를 먹고, 트랙패드가 없으면
// 가로로 굴릴 방법도 마땅치 않다. 화살표는 늘 같은 자리에 있다.
//
// **활성 탭 따라가기가 같이 있어야 한다.** 스크롤바를 감추면 ⌘W·Ctrl+Tab 으로 화면 밖
// 탭이 활성화됐을 때 아무것도 선택돼 보이지 않는다 — 스크롤바가 있던 시절에는 최소한
// 손잡이 위치로 짐작할 수 있었다. 화살표만 붙이고 이걸 빼면 그 자리가 새로 생긴다.

/** 한 번 누를 때 옮기는 폭. 보이는 너비의 이 비율만큼 — 끝 탭 하나는 겹쳐 보이게 남긴다. */
const PAGE_RATIO = 0.8

export interface TabStripScroll {
  /** 넘치는 줄(스크롤 컨테이너)에 건다 */
  ref: React.RefObject<HTMLDivElement | null>
  /** 왼쪽/오른쪽으로 더 갈 데가 있는가. 둘 다 false 면 화살표를 그릴 이유가 없다 */
  canLeft: boolean
  canRight: boolean
  scrollBy: (direction: -1 | 1) => void
}

/**
 * @param active 지금 보고 있는 탭. 바뀌면 그 탭이 보이도록 따라간다
 * @param count  탭 개수. 늘거나 줄면 넘침 여부가 달라진다
 */
export function useTabStripScroll(active: string, count: number): TabStripScroll {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const measure = useCallback(() => {
    const node = ref.current
    if (node === null) return

    // 1px 여유 — 소수점 배율(레티나·브라우저 확대)에서 끝까지 밀어도 scrollLeft 가
    // scrollWidth - clientWidth 에 딱 안 떨어져, 오른쪽 화살표가 영영 안 꺼진다.
    setCanLeft(node.scrollLeft > 1)
    setCanRight(node.scrollLeft + node.clientWidth < node.scrollWidth - 1)
  }, [])

  // 탭이 늘거나 줄면 넘침 여부가 달라진다. 스크롤·창 크기 변화도 같은 판정을 다시 태운다.
  useEffect(() => {
    const node = ref.current
    if (node === null) return

    measure()
    node.addEventListener('scroll', measure)
    // jsdom 에는 ResizeObserver 가 없다. 없으면 창 크기 변화만 못 볼 뿐 나머지는 그대로 돈다.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(node)
    return () => {
      node.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [measure, count])

  // 활성 탭을 보이는 데까지 끌어온다. `nearest` 라 이미 보이면 움직이지 않는다.
  useEffect(() => {
    const target = ref.current?.querySelector('[aria-selected="true"]')
    // jsdom 에는 scrollIntoView 가 없다 — 있는 환경에서만 부른다.
    if (target instanceof HTMLElement && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    measure()
  }, [active, count, measure])

  const scrollBy = useCallback((direction: -1 | 1) => {
    const node = ref.current
    if (node === null) return
    node.scrollBy({ left: direction * node.clientWidth * PAGE_RATIO, behavior: 'smooth' })
  }, [])

  return { ref, canLeft, canRight, scrollBy }
}
