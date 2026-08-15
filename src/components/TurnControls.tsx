import { useEffect, useRef, useState } from 'react'

// 턴 취소 상태 훅.
//
// 원래 여기 있던 「중단」 알약(TurnControls 컴포넌트)은 전송 버튼 자리로 옮겨졌다 —
// 응답 중에는 ↑ 가 빨간 중지 버튼이 된다 (Composer.tsx). 알약과 1초 지연(useDelayedShow)은
// 그때 함께 사라졌다: 버튼이 항상 그 자리에 있으니 나타났다 사라지는 깜빡임이 없다.
// 남은 것은 취소 요청의 상태 관리뿐이라 파일이 훅 하나가 됐다.

/**
 * 「중단중…」 을 푸는 상한.
 *
 * **중단이 끝난 신호는 `turn_ended` 하나뿐이다** — 그것이 `isStreaming` 을 내리고
 * (`sessionSlice.ts`) 중지 버튼이 ↑ 로 돌아간다. 그래서 정상 경로에서는 이 타이머가
 * 쓸 일이 없다. 쓰이는 것은 그 신호가 **영영 안 오는 경우**뿐이라 값은 그 아래 방어보다
 * 커야 한다: main 의 `TurnGate` 가 중단 요청 5초 뒤 턴을 강제로 닫는다
 * (`turnGate.ts` CANCEL_FORCE_CLOSE_MS). 그보다 짧게 잡으면 곧 닫힐 턴을 두고
 * "응답이 없다" 고 먼저 말하게 된다.
 */
const CANCEL_STALL_MS = 8_000

/**
 * 「중단중…」 상태.
 *
 * 누른 즉시 바뀌어야 한다 — opencode 의 `interrupt` 는 204 만 주고 실제 종료는 SSE 로
 * 뒤늦게 오기 때문에, 누른 티가 안 나면 사용자는 무시당했다고 읽고 또 누른다.
 * 푸는 것은 턴이 닫히는 것(busy=false)이거나 상한 초과 둘 중 하나다.
 *
 * ⚠️ **busy 가 꺼져도 이 훅은 살아 있다** — ChatComposer 가 항상 부르기 때문에,
 * 상태를 여기서 직접 풀지 않으면 「중단중…」 이 다음 턴까지 따라가
 * 버튼이 눌리지 않는 채로 남는다.
 */
export function useCancelRequest(busy: boolean): {
  pending: boolean
  stalled: boolean
  request: (send: () => void) => void
} {
  const [pending, setPending] = useState(false)
  const [stalled, setStalled] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (busy) return
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setPending(false)
    setStalled(false)
  }, [busy])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return {
    pending,
    stalled,
    request(send) {
      if (pending) return
      setPending(true)
      setStalled(false)
      timer.current = setTimeout(() => {
        timer.current = null
        setPending(false)
        setStalled(true)
      }, CANCEL_STALL_MS)
      send()
    },
  }
}
