import { useLayoutEffect, useRef } from 'react'

// Composer 의 입력 상자 보조 훅. Composer.tsx 가 300줄을 넘어 갈라냈다 —
// 둘 다 입력 상자 안에서만 쓰는 순수 동작이라 함께 둔다.

/** Esc 두 번을 "연속"으로 볼 최대 간격 */
const DOUBLE_ESC_WINDOW_MS = 1000

/**
 * 내용에 맞춰 높이를 늘린다.
 * 줄이는 경우까지 재려면 매번 auto 로 되돌려 scrollHeight 를 다시 재야 한다
 * (기존 height 가 남아 있으면 scrollHeight 가 줄어들지 않는다).
 */
export function useAutoGrow(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeightPx: number,
) {
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, maxHeightPx)}px`
  }, [ref, value, maxHeightPx])
}

/**
 * Esc 두 번 연속 감지.
 * "연속" = 두 Esc 사이에 다른 키가 없고, 간격이 DOUBLE_ESC_WINDOW_MS 이내.
 * 시각은 렌더와 무관하므로 ref 로 든다.
 */
export function useDoubleEscape(onDouble: () => void) {
  const lastEscAtRef = useRef<number | null>(null)

  const handler = () => {
    const last = lastEscAtRef.current
    const now = Date.now()
    if (last !== null && now - last <= DOUBLE_ESC_WINDOW_MS) {
      lastEscAtRef.current = null
      onDouble()
      return
    }
    lastEscAtRef.current = now
  }

  // 다른 키가 끼어들면 연속이 깨진다. Shift 같은 수식키 단독 입력도 동일하게
  // 취급한다 — 예외를 두면 "무엇이 끊는 키인가"를 사용자가 외워야 한다.
  handler.reset = () => {
    lastEscAtRef.current = null
  }

  return handler
}
