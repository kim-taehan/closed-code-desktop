import { useEffect, useRef, type RefObject } from 'react'

// 새 내용이 오면 맨 아래로 따라 내린다.
//
// **사용자가 위로 올려 읽고 있으면 따라가지 않는다** — 읽던 자리가 튀면
// 다시 찾아 내려와야 한다. 바닥 근처에 있을 때만 따라간다.
//
// 스트리밍 중에는 내용이 계속 늘어나므로 매번 판단한다.

/** 이만큼 안쪽이면 "바닥을 보고 있다" 로 친다. 스크롤이 딱 맞아떨어지는 일은 드물다. */
const NEAR_BOTTOM_PX = 80

export function useStickToBottom(ref: RefObject<HTMLElement | null>, dependency: unknown): void {
  // 마지막으로 본 위치가 바닥 근처였는지. 내용이 늘기 **전** 값이어야 한다.
  const wasAtBottom = useRef(true)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const onScroll = () => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight
      wasAtBottom.current = distance <= NEAR_BOTTOM_PX
    }

    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [ref])

  useEffect(() => {
    const element = ref.current
    if (!element || !wasAtBottom.current) return
    element.scrollTop = element.scrollHeight
  }, [ref, dependency])
}
