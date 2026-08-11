import { useEffect, useRef, useState } from 'react'
import {
  CLOCK_INTERVAL_MS,
  createProgressMachine,
  isSameView,
  type ProgressMachine,
  type ProgressView,
  type SpinnerMode,
} from './progressMachine'
import type { VerbsKoJson } from './verbs'

// 상태 기계에 50ms 마스터 클럭을 물리고, 뷰 스냅샷을 React 상태로 끌어올린다.
// 이 훅이 유일한 부수효과 지점이다 (타이머 · document.hidden).

export interface UseDavisProgressOptions {
  /** 턴이 도는 동안 true. false 로 내려가면 stop() 이다. */
  running: boolean
  mode: SpinnerMode
  /** 런타임이 준 진행 문구. null 이면 이번 턴에 뽑은 동사를 쓴다. */
  hint?: string | null
  /**
   * 값이 바뀔 때마다 noteActivity() — 정체 타이머를 되감는다.
   * 토큰 스트리밍처럼 문구는 그대로인데 진척은 있는 경우에 쓴다.
   */
  activityKey?: number | string
  verbs?: VerbsKoJson
  onStall?: () => void
}

const HIDDEN_VIEW: ProgressView = { visible: false, mode: 'idle', text: '', stalled: false }

export function useDavisProgress(options: UseDavisProgressOptions): ProgressView {
  const { running, mode, hint = null, activityKey, verbs, onStall } = options

  const [view, setView] = useState<ProgressView>(HIDDEN_VIEW)

  // 콜백은 매 렌더 새 함수일 수 있다. ref 로 감싸 최신 것을 부르되
  // 기계는 다시 만들지 않는다 — 재생성되면 뽑아둔 동사와 타이머가 날아간다.
  const onStallRef = useRef(onStall)
  onStallRef.current = onStall

  const machineRef = useRef<ProgressMachine | null>(null)
  if (machineRef.current === null) {
    machineRef.current = createProgressMachine({
      ...(verbs ? { verbs } : {}),
      onStall: () => onStallRef.current?.(),
    })
  }
  const machine = machineRef.current

  // 뷰가 실제로 달라졌을 때만 상태를 바꾼다. 클럭은 50ms 마다 돌지만 표시 내용은
  // 대개 그대로여서, 비교 없이 setState 하면 초당 20번 헛렌더가 난다.
  const syncView = () => {
    setView((prev) => {
      const next = machine.getView()
      return isSameView(prev, next) ? prev : next
    })
  }

  // 아래 세 effect 는 순서가 곧 호출 순서다. 원본 사용 순서(start → setMode → setHint)를
  // 지키려고 running 을 가장 먼저 둔다.
  useEffect(() => {
    if (running) {
      machine.start()
    } else {
      machine.stop()
    }
    syncView()
  }, [running])

  useEffect(() => {
    machine.setMode(mode)
    syncView()
  }, [mode])

  useEffect(() => {
    machine.setHint(hint)
    syncView()
  }, [hint])

  useEffect(() => {
    // 첫 렌더에도 한 번 불리지만 타이머를 0 으로 되감을 뿐이라 무해하다.
    machine.noteActivity()
  }, [activityKey])

  useEffect(() => {
    const timer = setInterval(() => {
      machine.tick(typeof document !== 'undefined' && document.hidden)
      syncView()
    }, CLOCK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  return view
}
