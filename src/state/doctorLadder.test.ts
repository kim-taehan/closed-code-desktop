import { describe, expect, it } from 'vitest'
import { advance, initPipeline, type CheckOutcome, type PipelineState } from './doctorPipeline'

// **치유 사다리 — 순수 머신의 전이만 본다.**
//
// `doctorPipeline.test.ts` 에서 갈라냈다 (300줄 상한). 가른 자리는 **진단과 치유** 사이다:
// 진단은 "무엇이 깨졌나" 를 답하고 치유는 "그럼 무엇을 하나" 를 답한다 — 둘이 같은
// 머신에 살 뿐 물음이 다르고, 설계가 바뀔 때 움직이는 쪽은 늘 치유였다.
//
// 이 칸이 부르는 **실제 IPC** 는 `doctorDriver.test.ts` 가 본다. 어느 칸으로 가는지(여기)와
// 그 칸이 무엇을 부르는지(저기)는 다른 물음이고, 둘 다 잠겨야 배선이 안 샌다.

const ok = (detail: string): CheckOutcome => ({ ok: true, detail })
const bad = (detail: string): CheckOutcome => ({ ok: false, detail })

const ids = (state: PipelineState): string[] => state.steps.map((step) => step.id)

/** 마지막(현재 회전) 단계 상태 */
function statusOf(state: PipelineState, id: string): string | undefined {
  const last = state.steps.map((step) => step.id).lastIndexOf(id as never)
  return state.steps[last]?.status
}

/** 실패 없이 끝까지 — 각 단계에 준 결과를 그대로 먹인다 */
function runAll(sessionOk: boolean, outcomes: CheckOutcome[]): PipelineState {
  let state = initPipeline(sessionOk)
  for (const outcome of outcomes) {
    if (state.next === null) break
    state = advance(state, outcome, sessionOk)
  }
  return state
}

// **치유 사다리가 세 칸이다** (설계 2026-08-16): 재연결 → 서버 되살리기 → 재연결.
//
// 갈라오기 전 이 자리에는 *"치유 사다리가 하나뿐이다 — opencode 서버는 사용자가 띄운 남의
// 프로세스라 우리가 죽였다 살릴 수 없다"* 고 적혀 있었다. **커밋 `c09cac8` 이후 거짓이다**:
// 서버는 프로젝트마다 우리가 띄운다. 남의 것은 여전히 못 죽이지만 **②를 갈라 줄 필요는
// 없다** — `pool.stop` 의 사정거리가 우리 자식뿐이라 조치 층이 이미 안전하다 (설계 §1 정정).

/** 진단 셋을 통과했는데 세션만 죽은 자리 — 사다리 ①의 입구 */
function toHeal(): PipelineState {
  return runAll(false, [ok('4096 응답'), ok('ollama-local (1)'), bad('세션 끊김')])
}

describe('치유 — 사다리 ① 재연결', () => {
  it('재연결이 성공하면 healed 로 끝난다', () => {
    const state = advance(toHeal(), ok('서버·세션이 살아났습니다'), true)
    expect(state.verdict).toBe('healed')
    expect(state.next).toBeNull()
    expect(statusOf(state, 'heal-reconnect')).toBe('ok')
  })

  // **여기가 사다리의 끝이었다** — *"다음 조치를 만들지 않는다"*. 이제 ②가 이어진다.
  it('재연결이 실패하면 ②(서버 되살리기)를 붙인다', () => {
    const state = advance(toHeal(), bad('재확인 시간 안에 연결되지 않았습니다'), false)
    expect(statusOf(state, 'heal-reconnect')).toBe('fail')
    expect(state.next).toBe('heal-restart-server')
    expect(state.verdict).toBeNull()
  })
})

// ⭐ **②는 갈래가 없다 — 칸이 하나다.**
//
// 한때 `ownership` 이 칸을 갈랐다(`heal-restart-server` / `heal-adopt-server`). 갈래를
// 세운 대가로 「갈아타기」가 고른 조치(`start`)가 세션이 살아 있을 때 **아무 일도 안 했다**
// (실측 2026-08-16). 조치 층이 이미 두 경우를 갈라 주고 있었다 — `pool.stop` 은 우리 자식만
// 끈다. 그래서 여기서는 **`ownership` 이 무엇이든 같은 칸이 서는지**를 본다.
describe('치유 ② — 주인이 무엇이든 칸은 하나다', () => {
  function afterReconnectFail(ownership?: 'ours' | 'theirs') {
    return advance(toHeal(), bad('재확인 시간 안에 연결되지 않았습니다'), false, ownership)
  }

  it('우리 것이든 남의 것이든 heal-restart-server 다', () => {
    expect(afterReconnectFail('ours').next).toBe('heal-restart-server')
    expect(afterReconnectFail('theirs').next).toBe('heal-restart-server')
    // 안 넘겨도 같다 — 기본값이 조치를 바꾸지 않는다
    expect(afterReconnectFail().next).toBe('heal-restart-server')
  })

  // **갈리는 것은 로그 문장뿐이다.** 사용자가 볼 말이 달라야 하는 이유는 두 경우가 실제로
  // 다른 일이기 때문이다 — 앞은 있던 것을 접었다 띄우고, 뒤는 없던 것을 세운다.
  it('주인에 따라 말이 갈린다 — 조치가 아니라 문구다', () => {
    expect(afterReconnectFail('ours').log.join('\n')).toContain('접었다 다시 띄웁니다')
    expect(afterReconnectFail('theirs').log.join('\n')).toContain('이 프로젝트용 서버를 띄웁니다')
  })

  it('서버 진단 실패에서도 같은 칸이 선다', () => {
    for (const ownership of ['ours', 'theirs'] as const) {
      expect(advance(initPipeline(false), bad('연결 거부'), false, ownership).next).toBe(
        'heal-restart-server',
      )
    }
  })
})

// ⭐ **③ — 재연결이 아니라 재확인이다.**
//
// *"서버를 되살렸다고 세션이 저절로 붙지는 않는다"* 고 보고 여기서 ①과 같은 재연결을
// 다시 불렀다. **틀렸다** (실측 2026-08-16): ②가 타는 경로는 세션을 새로 만들고 핸드셰이크
// ready 까지 기다렸다가 돌아온다. 그 위에 재연결을 또 부르면 **멀쩡한 세션을 접었다 붙이는
// 것**이고, 그 재조립이 실패하면 ②가 고쳐 놨는데도 사다리가 실패로 끝난다.
//
// 칸은 남는다 — 사다리가 「고쳤다」고 스스로 단정하지 않고 **검산한다.**
describe('치유 ③ — 되살린 뒤 검산만 한다', () => {
  function afterServerHeal(ownership: 'ours' | 'theirs', serverOk: boolean) {
    const second = advance(toHeal(), bad('재연결 실패'), false, ownership)
    return advance(second, serverOk ? ok('서버가 떴습니다') : bad('실행 파일을 찾지 못했습니다'), false)
  }

  it('서버가 뜨면 검산 칸이 붙는다 — 재연결이 아니다', () => {
    const state = afterServerHeal('ours', true)
    expect(state.next).toBe('heal-verify')
    expect(ids(state)).toEqual([
      'server',
      'model',
      'session',
      'heal-reconnect',
      'heal-restart-server',
      'heal-verify',
    ])
    // 재연결 칸이 두 번 서면 그것이 곧 「멀쩡한 세션을 다시 접는」 배선이다
    expect(ids(state).filter((id) => id === 'heal-reconnect')).toHaveLength(1)
  })

  it('서버를 못 띄우면 거기서 manual 이다', () => {
    const state = afterServerHeal('theirs', false)
    expect(state.verdict).toBe('manual')
    expect(state.next).toBeNull()
  })

  it('검산이 통과하면 healed 다', () => {
    const state = advance(afterServerHeal('ours', true), ok('살아났습니다'), true)
    expect(state.verdict).toBe('healed')
  })

  it('검산이 실패하면 manual 이다 — 여기서 조치를 더 하지 않는다', () => {
    const state = advance(afterServerHeal('ours', true), bad('여전히 안 붙는다'), false)
    expect(state.verdict).toBe('manual')
    expect(state.next).toBeNull()
  })
})

// ⭐⭐ **이 테스트가 없으면 재시작 루프가 조용히 산다** (설계 §5).
//
// ③이 실패했을 때 ②로 되돌아가면, 실패 조건이 그대로인 채 서버 재시작이 무한히 반복된다.
// 타입체크도 다른 테스트도 그 순환을 못 본다 — 한 바퀴만 보면 전부 정상으로 보이기 때문이다.
describe('한 바퀴가 상한이다 — 사다리는 ②로 되돌아가지 않는다', () => {
  function fullLadder(ownership: 'ours' | 'theirs') {
    let state = advance(toHeal(), bad('①실패'), false, ownership)
    state = advance(state, ok('서버가 떴습니다'), false, ownership)
    // ③(검산) 도 실패한다 — 여기서 ②로 돌아가면 루프다
    return advance(state, bad('③실패'), false, ownership)
  }

  it('②를 지난 뒤의 검산 실패는 manual 로 끝난다', () => {
    for (const ownership of ['ours', 'theirs'] as const) {
      const state = fullLadder(ownership)
      expect(state.verdict).toBe('manual')
      expect(state.next).toBeNull()
    }
  })

  it('서버 되살리기는 한 바퀴에 딱 한 번만 나온다', () => {
    const serverHeals = ids(fullLadder('ours')).filter((id) => id.endsWith('-server'))
    expect(serverHeals).toEqual(['heal-restart-server'])
  })

  it('끝난 뒤에는 더 먹여도 안 움직인다 — 드라이버가 while 로 돈다', () => {
    const done = fullLadder('ours')
    expect(advance(done, bad('무시돼야 한다'), false, 'ours')).toBe(done)
  })
})
