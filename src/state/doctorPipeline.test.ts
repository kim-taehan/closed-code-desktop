import { describe, expect, it } from 'vitest'
import { advance, initPipeline, type CheckOutcome, type PipelineState } from './doctorPipeline'

// 진단 상태 머신. **이 파일이 D1 의 본체다.**
//
// 이 코드는 2026-08-11 에 davis → opencode 로 번역됐는데 **번역이 옳은지 단언하는 것이
// 하나도 없는 상태로 착지했다.** 그리고 `doctorPipeline.ts:19` 가 스스로 *"화면 없이
// 단언한다"* 고 적어 뒀다 — 단언할 수 있게 만들어 놓고 안 하고 있던 것을 여기서 잠근다.
//
// **현 동작을 잠그는 것이 목적이다.** 이상해 보이는 자리가 있어도 여기서 고치지 않는다 —
// 고치면 "고치기 전 동작" 을 잠글 기회가 영영 사라진다.

const ok = (detail: string): CheckOutcome => ({ ok: true, detail })
const bad = (detail: string): CheckOutcome => ({ ok: false, detail })

/** 마지막(현재 회전) 단계 상태 — 재진단하면 같은 id 가 두 벌이 된다 */
function statusOf(state: PipelineState, id: string): string | undefined {
  const last = state.steps.map((step) => step.id).lastIndexOf(id as never)
  return state.steps[last]?.status
}
function detailOf(state: PipelineState, id: string): string | undefined {
  const last = state.steps.map((step) => step.id).lastIndexOf(id as never)
  return state.steps[last]?.detail
}
const ids = (state: PipelineState): string[] => state.steps.map((step) => step.id)

/** 실패 없이 끝까지 — 각 단계에 준 결과를 그대로 먹인다 */
function runAll(sessionOk: boolean, outcomes: CheckOutcome[]): PipelineState {
  let state = initPipeline(sessionOk)
  for (const outcome of outcomes) {
    if (state.next === null) break
    state = advance(state, outcome, sessionOk)
  }
  return state
}

describe('초기 상태', () => {
  it('server 부터 돈다 — 아래 계층이 살아야 위가 의미가 있다', () => {
    const state = initPipeline(true)
    expect(state.next).toBe('server')
    expect(ids(state)).toEqual(['server', 'model', 'session'])
  })

  // 5상 중 둘이 여기서 정해진다. 첫 단계만 running 이고 나머지는 pending 이다.
  it('첫 단계는 running, 나머지는 pending', () => {
    const state = initPipeline(true)
    expect(statusOf(state, 'server')).toBe('running')
    expect(statusOf(state, 'model')).toBe('pending')
    expect(statusOf(state, 'session')).toBe('pending')
    expect(state.verdict).toBeNull()
  })
})

describe('순서 — 통과하면 다음으로 넘어간다', () => {
  it('server ok → model 이 running 이 되고 next 가 model 이다', () => {
    const state = advance(initPipeline(true), ok('4096 응답'), true)
    expect(state.next).toBe('model')
    expect(statusOf(state, 'server')).toBe('ok')
    expect(statusOf(state, 'model')).toBe('running')
    expect(statusOf(state, 'session')).toBe('pending')
  })

  it('model ok → session 이 running 이 되고 next 가 session 이다', () => {
    const state = runAll(true, [ok('4096 응답'), ok('ollama-local (1)')])
    expect(state.next).toBe('session')
    expect(statusOf(state, 'model')).toBe('ok')
    expect(statusOf(state, 'session')).toBe('running')
  })

  it('결과 detail 이 그 단계에 그대로 붙는다', () => {
    const state = advance(initPipeline(true), ok('127.0.0.1:4096 응답'), true)
    expect(detailOf(state, 'server')).toBe('127.0.0.1:4096 응답')
  })
})

// **이 화면의 존재 이유다** — 「실패」와 「앞 단계 때문에 확인 못 함」을 가른다.
describe('blocked — 앞 단계가 실패하면 뒤는 확인하지 않는다', () => {
  const BLOCKED = '앞 단계가 실패해 확인할 수 없습니다'

  it('server 실패 → model·session 이 둘 다 blocked 가 되고 거기서 멈춘다', () => {
    const state = advance(initPipeline(true), bad('연결 거부'), true)

    expect(statusOf(state, 'server')).toBe('fail')
    expect(statusOf(state, 'model')).toBe('blocked')
    expect(statusOf(state, 'session')).toBe('blocked')
    // 멈춘다 — 나머지를 계속 돌리지 않는다
    expect(state.next).toBeNull()
    expect(state.verdict).toBe('manual')
  })

  it('server 실패 시 blocked 단계에 사유가 붙는다', () => {
    const state = advance(initPipeline(true), bad('연결 거부'), true)
    expect(detailOf(state, 'model')).toBe(BLOCKED)
    expect(detailOf(state, 'session')).toBe(BLOCKED)
  })

  // model 실패는 server 실패와 **다르다** — server 는 이미 ok 로 남는다.
  it('model 실패 → session 만 blocked 이고 server 는 ok 로 남는다', () => {
    const state = runAll(true, [ok('4096 응답'), bad('설정된 모델이 없습니다')])

    expect(statusOf(state, 'server')).toBe('ok')
    expect(statusOf(state, 'model')).toBe('fail')
    expect(statusOf(state, 'session')).toBe('blocked')
    expect(detailOf(state, 'session')).toBe(BLOCKED)
    expect(state.next).toBeNull()
    expect(state.verdict).toBe('manual')
  })

  // 실패한 단계에는 blocked 문구가 아니라 **그 단계가 받은 사유**가 남아야 한다
  it('실패한 단계 자신은 blocked 문구를 쓰지 않는다', () => {
    const state = runAll(true, [ok('4096 응답'), bad('설정된 모델이 없습니다')])
    expect(detailOf(state, 'model')).toBe('설정된 모델이 없습니다')
    expect(detailOf(state, 'model')).not.toBe(BLOCKED)
  })
})

describe('판정 (verdict)', () => {
  it('셋 다 통과하고 세션도 살아 있으면 healthy — 치유 단계를 만들지 않는다', () => {
    const state = runAll(true, [ok('4096 응답'), ok('ollama-local (1)'), ok('정상 · 세션 연결됨')])

    expect(state.verdict).toBe('healthy')
    expect(state.next).toBeNull()
    expect(ids(state)).toEqual(['server', 'model', 'session'])
  })

  // 서버·모델은 멀쩡한데 세션만 죽은 경우 — **우리가 고칠 수 있는 유일한 자리**
  it('세션만 문제면 치유 단계를 붙이고 재연결을 시킨다', () => {
    const state = runAll(false, [ok('4096 응답'), ok('ollama-local (1)'), bad('세션 끊김')])

    expect(state.next).toBe('heal-reconnect')
    expect(ids(state)).toEqual(['server', 'model', 'session', 'heal-reconnect'])
    expect(statusOf(state, 'heal-reconnect')).toBe('running')
    expect(state.verdict).toBeNull()
  })

  // 단계는 전부 ok 인데 세션 상태가 아직 안 붙은 경우 — steps 만 보면 healthy 로 오판한다
  it('단계가 다 ok 라도 sessionOk 가 거짓이면 healthy 가 아니다', () => {
    const state = runAll(false, [ok('4096 응답'), ok('ollama-local (1)'), ok('정상')])
    expect(state.verdict).not.toBe('healthy')
    expect(state.next).toBe('heal-reconnect')
  })

  // 서버가 죽은 채로 재연결하면 같은 자리에서 또 실패한다 — 시도하지 않는다
  it('server 가 죽었으면 재연결을 시도하지 않고 곧장 manual 이다', () => {
    const state = advance(initPipeline(false), bad('연결 거부'), false)
    expect(ids(state)).not.toContain('heal-reconnect')
    expect(state.verdict).toBe('manual')
  })

  it('model 이 없으면 재연결을 시도하지 않고 곧장 manual 이다', () => {
    const state = runAll(false, [ok('4096 응답'), bad('설정된 모델이 없습니다')])
    expect(ids(state)).not.toContain('heal-reconnect')
    expect(state.verdict).toBe('manual')
  })
})

// **치유 사다리가 하나뿐이다.** davis 는 재연결 → 재시작 → 재설치 3단이었는데,
// opencode 서버는 사용자가 띄운 남의 프로세스라 우리가 죽였다 살릴 수 없다.
describe('치유 — 사다리가 heal-reconnect 하나로 끝난다', () => {
  function toHeal(): PipelineState {
    return runAll(false, [ok('4096 응답'), ok('ollama-local (1)'), bad('세션 끊김')])
  }

  it('재연결이 성공하면 healed 로 끝난다', () => {
    const state = advance(toHeal(), ok('서버·세션이 살아났습니다'), true)
    expect(state.verdict).toBe('healed')
    expect(state.next).toBeNull()
    expect(statusOf(state, 'heal-reconnect')).toBe('ok')
  })

  // 여기가 사다리의 끝이다 — 다음 조치를 만들지 않는다
  it('재연결이 실패해도 다음 치유를 붙이지 않고 manual 로 끝난다', () => {
    const state = advance(toHeal(), bad('재확인 시간 안에 연결되지 않았습니다'), false)
    expect(state.verdict).toBe('manual')
    expect(state.next).toBeNull()
    expect(statusOf(state, 'heal-reconnect')).toBe('fail')
    expect(ids(state).filter((id) => id.startsWith('heal-'))).toEqual(['heal-reconnect'])
  })
})

describe('로그', () => {
  it('시작 줄로 연다', () => {
    expect(initPipeline(true).log).toEqual(['진단을 시작합니다'])
  })

  // 로그는 화면 아래에 그대로 흐른다 — 성공/실패와 사유가 한 줄에 들어가야 한다
  it('단계마다 행위·결과·사유를 한 줄로 쌓는다', () => {
    const state = advance(initPipeline(true), ok('4096 응답'), true)
    expect(state.log).toContain('opencode 서버 ping… 성공 (4096 응답)')
  })

  it('실패는 실패로 적고 사유를 붙인다', () => {
    const state = advance(initPipeline(true), bad('연결 거부'), true)
    expect(state.log).toContain('opencode 서버 ping… 실패 (연결 거부)')
    expect(state.log).toContain('서버 실패 → 이후 단계는 진행하지 않습니다')
  })

  it('healthy 로 끝나면 완료 줄이 남는다', () => {
    const state = runAll(true, [ok('a'), ok('b'), ok('c')])
    expect(state.log).toContain('진단 완료 — 모든 계층 정상')
  })
})

describe('끝난 뒤', () => {
  // 드라이버가 while 로 도는 구조라, 끝난 상태에 또 먹여도 안 움직여야 한다
  it('next 가 null 이면 더 먹여도 그대로다', () => {
    const done = runAll(true, [ok('a'), ok('b'), ok('c')])
    expect(advance(done, bad('무시돼야 한다'), true)).toBe(done)
  })
})

// 재진단하면 같은 id 가 두 벌이 될 수 있다 (`setStep` 이 lastIndexOf 를 쓰는 이유).
// 화면은 마지막 회전만 봐야 한다.
describe('재진단 — 같은 id 가 두 벌일 때', () => {
  it('마지막 회전의 단계를 고친다', () => {
    const first = runAll(true, [ok('a'), ok('b'), ok('c')])
    // 앞 회전의 단계 뒤에 새 회전을 이어 붙인 모양을 만든다
    const stacked: PipelineState = {
      ...initPipeline(true),
      steps: [...first.steps, { id: 'server', status: 'running' }],
    }
    const state = advance(stacked, bad('두 번째 회전 실패'), true)

    expect(detailOf(state, 'server')).toBe('두 번째 회전 실패')
    // 앞 회전의 server 는 건드리지 않는다
    expect(state.steps[0]?.status).toBe('ok')
  })
})
