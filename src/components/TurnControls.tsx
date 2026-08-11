import { useEffect, useState } from 'react'

// 턴 제어 — 취소.
//
// 전송 직후 바로 띄우지 않고 1초 기다린다.
// 짧은 응답에서는 버튼이 나타났다 사라지며 깜빡여 산만하다 (vscode 와 같은 값).

const CANCEL_VISIBLE_DELAY_MS = 1_000

export interface TurnControlsProps {
  /** 응답을 기다리는 중인가 */
  busy: boolean
  onCancel: () => void
}

export function TurnControls({ busy, onCancel }: TurnControlsProps) {
  const visible = useDelayedShow(busy, CANCEL_VISIBLE_DELAY_MS)
  if (!visible) return null

  return (
    <button type="button" className="turn-cancel" onClick={onCancel} title="응답 중단 (Esc)">
      중단
    </button>
  )
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
