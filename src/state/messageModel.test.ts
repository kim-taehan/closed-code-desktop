import { describe, expect, it } from 'vitest'
import { MessageKind, hasContent, isRenderableKind } from './messageModel'
import type { ChatMessage } from './messageModel'

// messageModel 은 렌더 판정의 최소 단위를 보장한다:
// 공백뿐인 TEXT 는 내용 없음으로 치고, 턴 안에서 그릴 수 있는 kind 만 렌더 대상이다.

function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm1', author: 'assistant', kind: MessageKind.TEXT, content: '내용', ...overrides }
}

describe('hasContent — 내용 있는가', () => {
  it('공백이 아닌 문자가 있으면 참', () => {
    expect(hasContent(msg({ content: '안녕' }))).toBe(true)
  })

  it('앞뒤 공백을 제거해도 글자가 남으면 참', () => {
    expect(hasContent(msg({ content: '  x  ' }))).toBe(true)
  })

  it('빈 문자열은 거짓', () => {
    expect(hasContent(msg({ content: '' }))).toBe(false)
  })

  it('공백·개행·탭뿐이면 거짓', () => {
    expect(hasContent(msg({ content: '   \n\t  ' }))).toBe(false)
  })
})

describe('isRenderableKind — 턴 안에서 그릴 수 있는 종류인가', () => {
  it('TEXT / TOOL_CALL / ERROR / AGENT_TASK_START / CODE_DIFF 는 렌더 대상', () => {
    expect(isRenderableKind(MessageKind.TEXT)).toBe(true)
    expect(isRenderableKind(MessageKind.TOOL_CALL)).toBe(true)
    expect(isRenderableKind(MessageKind.ERROR)).toBe(true)
    expect(isRenderableKind(MessageKind.AGENT_TASK_START)).toBe(true)
    expect(isRenderableKind(MessageKind.CODE_DIFF)).toBe(true)
  })

  it('SYSTEM 은 턴 안에서 렌더하지 않는다', () => {
    expect(isRenderableKind(MessageKind.SYSTEM)).toBe(false)
  })
})

describe('MessageKind 재노출', () => {
  it('shared 의 상수를 그대로 다시 내보낸다', () => {
    expect(MessageKind.TEXT).toBe('text')
    expect(MessageKind.SYSTEM).toBe('system')
  })
})
