import { useEffect, useRef, useState } from 'react'

// 턴 제어 — 취소.
//
// 전송 직후 바로 띄우지 않고 1초 기다린다.
// 짧은 응답에서는 버튼이 나타났다 사라지며 깜빡여 산만하다 (vscode 와 같은 값).

const CANCEL_VISIBLE_DELAY_MS = 1_000

/**
 * 「중단중…」 을 푸는 상한.
 *
 * **중단이 끝난 신호는 `turn_ended` 하나뿐이다** — 그것이 `isStreaming` 을 내리고
 * (`sessionSlice.ts`) 이 컴포넌트가 통째로 사라진다. 그래서 정상 경로에서는 이 타이머가
 * 쓸 일이 없다. 쓰이는 것은 그 신호가 **영영 안 오는 경우**뿐이라 값은 그 아래 방어보다
 * 커야 한다: main 의 `TurnGate` 가 중단 요청 5초 뒤 턴을 강제로 닫는다
 * (`turnGate.ts` CANCEL_FORCE_CLOSE_MS). 그보다 짧게 잡으면 곧 닫힐 턴을 두고
 * "응답이 없다" 고 먼저 말하게 된다.
 */
const CANCEL_STALL_MS = 8_000

export interface TurnControlsProps {
  /** 응답을 기다리는 중인가 */
  busy: boolean
  onCancel: () => void
}

export function TurnControls({ busy, onCancel }: TurnControlsProps) {
  const visible = useDelayedShow(busy, CANCEL_VISIBLE_DELAY_MS)
  const cancel = useCancelRequest(busy)
  if (!visible) return null

  return (
    <>
      <button
        type="button"
        className="turn-cancel"
        disabled={cancel.pending}
        onClick={() => cancel.request(onCancel)}
        title="응답 중단 (Esc)"
      >
        {cancel.pending ? '중단중…' : '중단'}
      </button>
      {/* 상한을 넘겼다 — 버튼은 다시 눌리게 풀고, 아무 일도 없었다는 사실을 말한다.
          말없이 「중단」 으로 되돌리면 사용자는 자기가 잘못 눌렀다고 여긴다. */}
      {cancel.stalled && <span className="turn-cancel-stalled">중단 신호에 응답이 없습니다. 다시 눌러 보세요.</span>}
    </>
  )
}

/**
 * 「중단중…」 상태.
 *
 * 누른 즉시 바뀌어야 한다 — opencode 의 `interrupt` 는 204 만 주고 실제 종료는 SSE 로
 * 뒤늦게 오기 때문에, 누른 티가 안 나면 사용자는 무시당했다고 읽고 또 누른다.
 * 푸는 것은 턴이 닫히는 것(busy=false)이거나 상한 초과 둘 중 하나다.
 *
 * ⚠️ **busy 가 꺼져도 이 컴포넌트는 언마운트되지 않는다** — ChatComposer 가 항상 렌더하고
 * 감추는 것은 `visible` 뿐이라, 상태를 여기서 직접 풀지 않으면 「중단중…」 이 다음 턴까지
 * 따라가 버튼이 눌리지 않는 채로 남는다.
 */
function useCancelRequest(busy: boolean): {
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

/** 켜질 땐 지연, 꺼질 땐 즉시. 로딩 표시와 반대다. */
function useDelayedShow(active: boolean, delayMs: number): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!active) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(true), delayMs)
    return () => clearTimeout(timer)
  }, [active, delayMs])

  return visible
}
