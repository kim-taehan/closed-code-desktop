import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProgressMachine, type ProgressMachine } from './progressMachine'

// vscode 원본(webview/lib/davis-progress)의 상태·타이밍 계약.
// 사전과 접미사 규칙 자체는 verbs.test.ts 에서 본다.

const verbs = {
  suffix: ' 중...',
  thinking: ['생각하는', '따져보는'],
  crafting: ['엮는'],
  searching: ['뒤지는'],
  cooking: ['졸이는'],
  nature: ['자아내는'],
  playful: ['흥얼거리는'],
}

/** 클럭을 ms 만큼 민다 — 50ms 단위로 tick 을 부르는 것과 같다 */
function advance(machine: ProgressMachine, ms: number, hidden = false) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    machine.tick(hidden)
  }
}

/** 디바운스(300ms)를 넘겨 표시 상태로 만든다 */
function makeVisible(machine: ProgressMachine) {
  advance(machine, 300)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('접미사', () => {
  it('사전에 suffix 가 없으면 " 중..." 을 쓴다', () => {
    const machine = createProgressMachine({ verbs: { ...verbs, suffix: undefined } })
    machine.start()
    machine.setMode('requesting')
    machine.setHint('작업')
    expect(machine.getView().text).toBe('작업 중...')
  })
})

describe('표시 지연 (300ms 디바운스)', () => {
  it('시작 직후에는 보이지 않는다', () => {
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('requesting')
    expect(machine.getView().visible).toBe(false)
  })

  it('250ms 까지는 보이지 않는다', () => {
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('requesting')
    advance(machine, 250)
    expect(machine.getView().visible).toBe(false)
  })

  it('300ms 를 채우면 보인다', () => {
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('requesting')
    advance(machine, 300)
    expect(machine.getView().visible).toBe(true)
  })

  it('mode 가 idle 이면 시간이 지나도 보이지 않는다', () => {
    const machine = createProgressMachine({ verbs })
    machine.start()
    makeVisible(machine)
    expect(machine.getView().visible).toBe(false)
  })

  it('stop 하면 즉시 숨는다', () => {
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('requesting')
    makeVisible(machine)
    machine.stop()
    expect(machine.getView().visible).toBe(false)
  })

  it('돌지 않으면 클럭도 흐르지 않는다', () => {
    const machine = createProgressMachine({ verbs })
    machine.setMode('requesting')
    advance(machine, 1000)
    expect(machine.getView().visible).toBe(false)
  })

  it('document 가 가려진 동안에는 클럭이 멈춘다', () => {
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('requesting')
    advance(machine, 1000, true)
    expect(machine.getView().visible).toBe(false)

    advance(machine, 300)
    expect(machine.getView().visible).toBe(true)
  })
})

describe('표시 문구', () => {
  it('힌트가 없으면 이번 턴에 뽑은 동사를 쓴다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('requesting')
    expect(machine.getView().text).toBe('생각하는 중...')
  })

  it('동사는 턴당 한 번만 뽑고 턴 내내 유지된다', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('requesting')
    advance(machine, 5000)

    expect(random).toHaveBeenCalledTimes(1)
    expect(machine.getView().text).toBe('생각하는 중...')
  })

  it('다시 start 하면 새 동사를 뽑는다', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.stop()
    machine.start()
    expect(random).toHaveBeenCalledTimes(2)
  })

  it('이미 돌고 있으면 start 를 다시 불러도 동사를 다시 뽑지 않는다', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.start()
    expect(random).toHaveBeenCalledTimes(1)
  })

  it('힌트가 있으면 힌트가 이긴다', () => {
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('tool-use')
    machine.setHint('파일 읽는')
    expect(machine.getView().text).toBe('파일 읽는 중...')
  })

  it('힌트가 null 로 돌아가면 동사가 아니라 직전 힌트를 유지한다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('tool-use')
    machine.setHint('파일 읽는')
    machine.setHint(null)
    expect(machine.getView().text).toBe('파일 읽는 중...')
  })

  it('힌트가 빈 문자열이면 직전 문구로 떨어진다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('requesting')
    machine.setHint('')
    expect(machine.getView().text).toBe('생각하는 중...')
  })
})

describe('mode', () => {
  it('설정한 mode 를 그대로 내보낸다', () => {
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('responding')
    expect(machine.getView().mode).toBe('responding')
  })

  it('stop 하면 idle 이 된다', () => {
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('responding')
    machine.stop()
    expect(machine.getView().mode).toBe('idle')
  })
})

describe('정체 감지 (3초)', () => {
  it('3초가 지나면 stalled 다', () => {
    const onStall = vi.fn()
    const machine = createProgressMachine({ verbs, onStall })
    machine.start()
    machine.setMode('requesting')
    advance(machine, 3000)

    expect(machine.getView().stalled).toBe(true)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('2950ms 까지는 정체가 아니다', () => {
    const onStall = vi.fn()
    const machine = createProgressMachine({ verbs, onStall })
    machine.start()
    machine.setMode('requesting')
    advance(machine, 2950)

    expect(machine.getView().stalled).toBe(false)
    expect(onStall).not.toHaveBeenCalled()
  })

  it('정체가 이어져도 콜백은 한 번만 쏜다', () => {
    const onStall = vi.fn()
    const machine = createProgressMachine({ verbs, onStall })
    machine.start()
    machine.setMode('requesting')
    advance(machine, 10_000)

    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('noteActivity 가 타이머를 되감는다', () => {
    const onStall = vi.fn()
    const machine = createProgressMachine({ verbs, onStall })
    machine.start()
    machine.setMode('requesting')
    advance(machine, 2500)
    machine.noteActivity()
    advance(machine, 1000)

    expect(machine.getView().stalled).toBe(false)
    expect(onStall).not.toHaveBeenCalled()
  })

  it('힌트가 오면 타이머가 되감긴다', () => {
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('requesting')
    advance(machine, 2500)
    machine.setHint('도구 도는')
    advance(machine, 1000)

    expect(machine.getView().stalled).toBe(false)
  })

  it('mode 가 바뀌면 타이머가 되감긴다', () => {
    const machine = createProgressMachine({ verbs })
    machine.start()
    machine.setMode('requesting')
    advance(machine, 2500)
    machine.setMode('responding')
    advance(machine, 1000)

    expect(machine.getView().stalled).toBe(false)
  })

  it('정체에서 풀리면 다음 정체 때 다시 쏜다', () => {
    const onStall = vi.fn()
    const machine = createProgressMachine({ verbs, onStall })
    machine.start()
    machine.setMode('requesting')
    advance(machine, 3000)
    machine.noteActivity()
    advance(machine, 3000)

    expect(onStall).toHaveBeenCalledTimes(2)
  })

  it('아직 화면에 뜨지 않았으면 콜백을 쏘지 않는다', () => {
    // 디바운스가 안 끝난 상태에서는 정체를 알릴 표시기 자체가 없다
    const onStall = vi.fn()
    const machine = createProgressMachine({ verbs, onStall })
    machine.start()
    machine.setMode('idle')
    advance(machine, 5000)

    expect(onStall).not.toHaveBeenCalled()
  })
})
