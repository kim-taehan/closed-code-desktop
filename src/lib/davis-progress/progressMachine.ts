import { applySuffix, DEFAULT_VERBS, pickRandomVerb, resolveSuffix, type VerbsKoJson } from './verbs'

// 진행 표시기의 상태 기계. DOM 도 타이머도 모르며, 시간은 바깥에서 tick() 으로 밀어 넣는다.
// (원본 vscode 판은 50ms setInterval 안에서 직접 DOM 을 조작했다. 여기서는 시간 전진과
//  렌더를 분리해 로직만 node 환경에서 테스트할 수 있게 했다.)

/** 원본 union 그대로. 'thinking' 은 현재 배선에서 쓰이지 않지만 계약을 좁히지 않는다. */
export type SpinnerMode = 'requesting' | 'thinking' | 'tool-use' | 'responding' | 'idle'

/** 마스터 클럭 주기. 이 값이 시간 해상도이자 tick 1회의 가중치다. */
export const CLOCK_INTERVAL_MS = 50
/** 이 시간이 지나야 표시기가 보인다 — 짧은 작업에서 깜빡이는 것을 막는다. */
export const DEBOUNCE_DURATION_MS = 300
/** 활동 없이 이만큼 지나면 정체로 본다. */
export const STALL_THRESHOLD_MS = 3000

export interface ProgressView {
  visible: boolean
  mode: SpinnerMode
  /** 접미사까지 붙은 최종 표시 문구 */
  text: string
  stalled: boolean
}

export interface ProgressMachineOptions {
  verbs?: VerbsKoJson
  onStall?: () => void
}

export interface ProgressMachine {
  setMode(mode: SpinnerMode): void
  setHint(text: string | null): void
  start(): void
  stop(): void
  noteActivity(): void
  /** 클럭 1회 전진. documentHidden 이면 시간이 흐르지 않는다. */
  tick(documentHidden?: boolean): void
  getView(): ProgressView
}

export function createProgressMachine(opts: ProgressMachineOptions = {}): ProgressMachine {
  const verbs = opts.verbs ?? DEFAULT_VERBS
  const suffix = resolveSuffix(verbs)
  const { onStall } = opts

  let currentMode: SpinnerMode = 'idle'
  let currentHint: string | null = null
  let currentVerb = ''
  let lastDisplayText = ''
  let isRunning = false
  let isVisible = false

  let clockMs = 0
  let stallTimerMs = 0
  let stallNotified = false

  function isShowing(): boolean {
    return isRunning && isVisible && currentMode !== 'idle'
  }

  function isStalled(): boolean {
    return stallTimerMs >= STALL_THRESHOLD_MS
  }

  /**
   * 원본 updateDOM 의 부수효과(정체 콜백) 부분.
   * 숨겨져 있는 동안에는 콜백을 쏘지 않는다 — 원본이 표시 여부를 먼저 검사하고
   * early return 하므로, 화면에 뜨지도 않은 표시기 때문에 알림이 울리지 않는다.
   */
  function refresh(): void {
    if (!isShowing()) {
      return
    }
    if (isStalled() && !stallNotified) {
      stallNotified = true
      onStall?.()
    } else if (!isStalled()) {
      stallNotified = false
    }
  }

  function resetStall(): void {
    stallTimerMs = 0
    stallNotified = false
  }

  return {
    setMode(mode: SpinnerMode) {
      currentMode = mode
      if (mode !== 'idle') {
        resetStall()
      }
      refresh()
    },

    setHint(text: string | null) {
      currentHint = text
      // 힌트가 온 것 자체가 활동 신호다. 또 마지막 힌트를 남겨두어, 힌트가 null 로
      // 돌아가도 처음 뽑은 동사가 아니라 직전 문구를 계속 보여준다.
      if (text !== null) {
        lastDisplayText = text
        resetStall()
      }
      refresh()
    },

    start() {
      // 이미 도는 중이면 무시한다. 재진입해도 동사가 다시 뽑히지 않는다는 뜻이기도 하다.
      if (isRunning) {
        return
      }
      isRunning = true
      isVisible = false
      clockMs = 0
      resetStall()
      // 동사는 턴당 한 번만 뽑는다. 매 tick 마다 바꾸면 글자가 요동쳐 읽을 수 없다.
      currentVerb = pickRandomVerb(verbs)
      lastDisplayText = currentVerb
      refresh()
    },

    stop() {
      isRunning = false
      currentMode = 'idle'
      refresh()
    },

    noteActivity() {
      // 원본과 동일하게 refresh 를 부르지 않는다. 타이머만 되감고 표시 갱신은
      // 다음 tick 에 맡긴다.
      resetStall()
    },

    tick(documentHidden = false) {
      if (!isRunning) {
        return
      }
      // 탭이 가려져 있으면 시간이 흐르지 않는다 — 백그라운드에 두고 온 사이에
      // 정체로 오판하는 것을 막는다.
      if (documentHidden) {
        return
      }

      clockMs += CLOCK_INTERVAL_MS
      stallTimerMs += CLOCK_INTERVAL_MS

      if (clockMs >= DEBOUNCE_DURATION_MS) {
        isVisible = true
      }

      refresh()
    },

    getView(): ProgressView {
      // 우선순위: 힌트 > 마지막 힌트 > 이번 턴의 동사
      const displayText = currentHint || lastDisplayText || currentVerb
      return {
        visible: isShowing(),
        mode: currentMode,
        text: applySuffix(displayText, suffix),
        stalled: isStalled(),
      }
    },
  }
}

export function isSameView(a: ProgressView, b: ProgressView): boolean {
  return a.visible === b.visible && a.mode === b.mode && a.text === b.text && a.stalled === b.stalled
}
