import { useEffect, useState } from 'react'
import { DavisProgress, type SpinnerMode } from '../lib/davis-progress'

// 진행 표시 (설계 §6.8).
//
// 표시는 즉시, **해제는 320ms 지연**한다.
// 턴이 도구 실행 등으로 잠깐 끊길 때마다 표시기가 깜빡이면 산만해진다.
// 지연을 두면 짧은 공백은 그냥 이어져 보인다.

// 내보내는 이유는 시험 때문이다 (`useOptimisticBusy` 의 `HANDOFF_MS` 와 같은 규칙) —
// 조립 시험(`App.wiring.test.tsx`)이 이 숫자를 손으로 적으면 값을 고친 날 그 시험만
// 조용히 헛돈다.
export const HIDE_DELAY_MS = 320

export interface LoadingIndicatorProps {
  /** 스트리밍 중이거나 승인 대기 중 */
  active: boolean
  mode: SpinnerMode
  /** 런타임이 준 진행 문구. 없으면 이번 턴에 뽑은 동사를 쓴다. */
  hint?: string | null
  /** 값이 바뀌면 정체 타이머가 되감긴다 — 텍스트 청크 수를 넣으면 된다 */
  activityKey?: number
}

export function LoadingIndicator({ active, mode, hint, activityKey }: LoadingIndicatorProps) {
  const visible = useDelayedHide(active, HIDE_DELAY_MS)
  if (!visible) return null

  return (
    <div className="message assistant">
      <div className="message-content">
        <DavisProgress
          running={visible}
          mode={mode}
          {...(hint !== undefined ? { hint } : {})}
          {...(activityKey !== undefined ? { activityKey } : {})}
        />
      </div>
    </div>
  )
}

/** 켜질 땐 즉시, 꺼질 땐 지연. 다시 켜지면 대기 중인 해제를 취소한다. */
function useDelayedHide(active: boolean, delayMs: number): boolean {
  const [visible, setVisible] = useState(active)

  useEffect(() => {
    if (active) {
      setVisible(true)
      return
    }
    const timer = setTimeout(() => setVisible(false), delayMs)
    return () => clearTimeout(timer)
  }, [active, delayMs])

  return visible
}
