import { describe, expect, it } from 'vitest'
import { MessageKind, type ChatMessage } from './messageModel'
import { extractReply, isTurnInterrupted, type ReplyContext } from './replyExtraction'

// replyExtraction 은 접히는 body 바깥에 남길 "답변"을 고른다:
//  1) semanticType 'reply' 인 마지막 TEXT 는 턴이 안 끝나도 이긴다
//  2) 끝난 턴이면 내용 있는 마지막 TEXT
//  3) 중단된 턴은 얼려두고 아무것도 안 뽑는다

function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm', author: 'assistant', kind: MessageKind.TEXT, content: '답', ...overrides }
}

function ctx(overrides: Partial<ReplyContext> = {}): ReplyContext {
  return { turnEnded: false, turnInterrupted: false, ...overrides }
}

describe('extractReply — 답변 고르기', () => {
  it('중단된 턴은 답변을 뽑지 않는다', () => {
    const messages = [msg({ id: 'a', semanticType: 'reply' })]
    expect(extractReply(messages, ctx({ turnInterrupted: true, turnEnded: true }))).toBeUndefined()
  })

  it('semanticType reply 는 턴이 안 끝나도 이긴다', () => {
    const messages = [msg({ id: 'a' }), msg({ id: 'b', semanticType: 'reply', content: '최종' })]
    expect(extractReply(messages, ctx({ turnEnded: false }))?.id).toBe('b')
  })

  it('reply 후보가 여러 개면 마지막을 고른다', () => {
    const messages = [
      msg({ id: 'a', semanticType: 'reply' }),
      msg({ id: 'b' }),
      msg({ id: 'c', semanticType: 'reply' }),
    ]
    expect(extractReply(messages, ctx())?.id).toBe('c')
  })

  it('내용 없는 reply 는 무시한다', () => {
    const messages = [msg({ id: 'a', semanticType: 'reply', content: '  ' })]
    expect(extractReply(messages, ctx({ turnEnded: false }))).toBeUndefined()
  })

  it('reply 가 없고 턴이 안 끝났으면 아무것도 안 뽑는다', () => {
    const messages = [msg({ id: 'a' }), msg({ id: 'b' })]
    expect(extractReply(messages, ctx({ turnEnded: false }))).toBeUndefined()
  })

  it('reply 가 없고 턴이 끝났으면 내용 있는 마지막 TEXT', () => {
    const messages = [msg({ id: 'a' }), msg({ id: 'b', content: '끝' }), msg({ id: 'c', content: ' ' })]
    expect(extractReply(messages, ctx({ turnEnded: true }))?.id).toBe('b')
  })

  it('reply 아닌 TEXT 만 있고 semantic 우선순위는 kind 로 거른다 — TOOL_CALL 은 후보 아님', () => {
    const messages = [
      msg({ id: 't', kind: MessageKind.TOOL_CALL, content: '도구' }),
      msg({ id: 'x', content: '텍스트' }),
    ]
    expect(extractReply(messages, ctx({ turnEnded: true }))?.id).toBe('x')
  })

  it('턴이 끝났어도 내용 있는 TEXT 가 없으면 없음', () => {
    const messages = [msg({ id: 'a', content: '' }), msg({ id: 'b', kind: MessageKind.ERROR, content: '오류' })]
    expect(extractReply(messages, ctx({ turnEnded: true }))).toBeUndefined()
  })

  it('빈 배열이면 없음', () => {
    expect(extractReply([], ctx({ turnEnded: true }))).toBeUndefined()
  })
})

describe('isTurnInterrupted — 턴 안에 중단이 있는가', () => {
  it('하나라도 interrupted 면 참', () => {
    expect(isTurnInterrupted([msg(), msg({ interrupted: true })])).toBe(true)
  })

  it('아무것도 중단 안 됐으면 거짓', () => {
    expect(isTurnInterrupted([msg(), msg({ interrupted: false })])).toBe(false)
  })

  it('빈 배열이면 거짓', () => {
    expect(isTurnInterrupted([])).toBe(false)
  })
})
