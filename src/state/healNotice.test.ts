import { describe, expect, it } from 'vitest'
import { healNotice } from './healNotice'
import { advance, initPipeline, type CheckOutcome, type PipelineState } from './doctorPipeline'

// **2단 승격과 예고를 잠근다** (설계 2026-08-16 §3).
//
// 이 판정이 틀리면 증상이 조용하다: 가벼운 재연결에 배너가 뜨거나(방해), 서버를 다시
// 띄우는데 상태줄 한 줄만 지나간다(무거운 조치를 몰래 한다). 둘 다 화면을 보면 알지만
// **화면을 봐야만** 알고, 그래서 여기서 화면 없이 단언한다.

const ok = (detail: string): CheckOutcome => ({ ok: true, detail })
const bad = (detail: string): CheckOutcome => ({ ok: false, detail })

/** 진단 셋을 통과하고 세션만 죽은 자리 — 사다리 ①의 입구 */
function atReconnect(): PipelineState {
  let state = initPipeline(false)
  for (const outcome of [ok('4096 응답'), ok('ollama-local (1)'), bad('세션 끊김')]) {
    state = advance(state, outcome, false)
  }
  return state
}

describe('말할 것이 없을 때', () => {
  it('아직 안 돌았으면 null 이다', () => {
    expect(healNotice(null)).toBeNull()
  })

  // 잘 끝났으면 조용하다 — 가볍게 복구되면 사용자는 거의 모르고 지나간다
  it('healthy·healed 는 null 이다', () => {
    let state = initPipeline(true)
    for (const outcome of [ok('a'), ok('b'), ok('c')]) state = advance(state, outcome, true)
    expect(state.verdict).toBe('healthy')
    expect(healNotice(state)).toBeNull()

    const healed = advance(atReconnect(), ok('살아났습니다'), true)
    expect(healed.verdict).toBe('healed')
    expect(healNotice(healed)).toBeNull()
  })
})

describe('승격 — 어디에 보이나', () => {
  it('진단 중에는 상태줄이다', () => {
    expect(healNotice(initPipeline(false))?.stage).toBe('statusline')
  })

  // ⭐ ①만 도는 동안은 상태줄이다. **그리고 예고가 여기 들어간다.**
  it('①(재연결)은 상태줄이고, 다음에 무엇을 할지 미리 말한다', () => {
    const notice = healNotice(atReconnect())
    expect(notice?.stage).toBe('statusline')
    expect(notice?.headline).toContain('서버를 다시 띄웁니다')
  })

  // ⭐ 무거운 조치는 알린다
  it('②는 배너로 올라간다', () => {
    const notice = healNotice(advance(atReconnect(), bad('재연결 실패'), false, 'ours'), 'ours')
    expect(notice?.stage).toBe('banner')
    expect(notice?.headline).toContain('재연결이 실패했습니다')
    expect(notice?.headline).toContain('다시 띄웁니다')
  })

  // ⭐ **조치는 하나이고 말만 갈린다** — 남의 서버를 살려 둔다는 사실을 문구가 말한다
  // (설계 §6 미결 1). 사다리 칸은 둘 다 `heal-restart-server` 로 같다.
  it('②의 문구는 주인에 따라 갈린다 — 칸은 같다', () => {
    const state = advance(atReconnect(), bad('재연결 실패'), false, 'theirs')
    expect(state.next).toBe('heal-restart-server')
    expect(healNotice(state, 'theirs')?.headline).toContain('건드리지 않습니다')
    expect(healNotice(state, 'ours')?.headline).toContain('재연결이 실패했습니다')
  })

  // **모르면 「남의 것」 쪽 문장이다** — 그 문장이 "죽었거나 남의 것" 을 함께 덮는다
  it('주인을 안 넘기면 살려 둔다는 쪽으로 말한다', () => {
    const state = advance(atReconnect(), bad('재연결 실패'), false)
    expect(healNotice(state)?.headline).toContain('건드리지 않습니다')
  })

  // ③은 **조치가 아니라 검산이다.** "붙이는 중" 이라고 하면 하지도 않는 일을 알리는 것이 된다
  it('③(검산)은 배너에 남고, 붙이는 중이라고 말하지 않는다', () => {
    const second = advance(atReconnect(), bad('재연결 실패'), false, 'ours')
    const third = advance(second, ok('서버가 떴습니다'), false)
    expect(third.next).toBe('heal-verify')
    const notice = healNotice(third, 'ours')
    expect(notice?.stage).toBe('banner')
    expect(notice?.headline).toContain('확인하는 중')
    expect(notice?.headline).not.toContain('붙입니다')
  })

  it('최종 실패는 창이다', () => {
    const second = advance(atReconnect(), bad('재연결 실패'), false, 'ours')
    const failed = advance(second, bad('서버가 안 뜬다'), false)
    expect(failed.verdict).toBe('manual')
    expect(healNotice(failed)?.stage).toBe('doctor')
  })
})

// 근거는 **마지막으로 실패한 단계**의 사유다 — "왜" 를 잃으면 배너가 잔소리가 된다
describe('근거', () => {
  it('실패한 단계의 이름과 사유를 함께 싣는다', () => {
    const notice = healNotice(advance(atReconnect(), bad('재확인 시간 초과'), false, 'ours'), 'ours')
    expect(notice?.detail).toBe('재연결: 재확인 시간 초과')
  })

  // 상태줄은 근거를 안 싣는다 — 한 줄이 축이고, 아직 아무것도 안 건드렸다
  it('상태줄에는 근거가 없다', () => {
    expect(healNotice(atReconnect())?.detail).toBeUndefined()
  })
})
