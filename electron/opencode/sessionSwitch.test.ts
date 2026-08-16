import { describe, expect, it } from 'vitest'
import { Action } from '../../shared/protocol/kinds'
import { nextSession, reusableSession, type SessionState } from './sessionSwitch'

// `transport.ts` 에서 갈라낸 전이. 여기 갈래가 틀리면 증상이 전부 **조용하다** —
// 세션이 안 갈리면 답이 원래 세션에 쌓이고, 안 놓으면 다음 프롬프트가 404 로 죽는다.

const state = (sessionId: string | null, emptySession: boolean): SessionState => ({
  sessionId,
  emptySession,
})

describe('reusableSession', () => {
  it('말을 걸기 전이면 그 세션을 재사용한다 — 핸드셰이크가 만들어 둔 것이다', () => {
    expect(reusableSession(state('ses_a', true))).toBe('ses_a')
  })

  it('말을 건 뒤에는 없다 — 「새 대화」는 새 세션을 받아야 한다', () => {
    expect(reusableSession(state('ses_a', false))).toBeNull()
  })
})

describe('nextSession', () => {
  it('새 대화로 받은 세션은 아직 비어 있다', () => {
    const after = nextSession(state('ses_a', false), Action.CHAT_HISTORY_ADD, {}, 'ses_b')
    expect(after).toEqual({ sessionId: 'ses_b', emptySession: true })
  })

  // 불러온 대화는 이미 말이 오간 것이다. 여기서 true 를 주면 「새 대화」가 그 대화를
  // 재사용해 **과거 대화 위에 새 대화가 이어 붙는다**.
  it('불러온 대화는 비어 있지 않다', () => {
    const after = nextSession(state('ses_a', true), Action.CHAT_HISTORY_LOAD, {}, 'ses_b')
    expect(after).toEqual({ sessionId: 'ses_b', emptySession: false })
  })

  // 안 놓으면 다음 프롬프트가 없어진 세션으로 나간다 — 증상은 채팅이 404 로 죽는 것뿐이다.
  it('열려 있던 대화를 지우면 세션 id 를 놓는다', () => {
    const data = { chat_id: 'ses_a' }
    expect(nextSession(state('ses_a', false), Action.CHAT_HISTORY_REMOVE, data, null).sessionId).toBeNull()
  })

  it('남의 대화를 지운 것은 내 세션을 안 건드린다', () => {
    const data = { chat_id: 'ses_z' }
    const before = state('ses_a', false)
    expect(nextSession(before, Action.CHAT_HISTORY_REMOVE, data, null)).toBe(before)
  })

  // 목록 조회처럼 세션을 안 바꾸는 봉투. `chat_id` 가 없어 `removed` 가 null 인데,
  // 세션도 null 이면 `null === null` 로 「지웠다」 갈래에 걸린다 — 결과가 같아야 한다.
  it('세션이 없을 때 세션을 안 바꾸는 봉투가 와도 그대로다', () => {
    expect(nextSession(state(null, false), Action.CHAT_HISTORY_LIST, {}, null)).toEqual(
      state(null, false),
    )
  })
})
