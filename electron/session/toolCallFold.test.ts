import { describe, expect, it } from 'vitest'
import { MessageKind, type ChatMessage } from '../../shared/ipc/messageTypes'
import { foldToolResult } from './toolCallFold'

// tool_result 를 기존 tool_call 에 접는다 (설계 §5.2). 매칭 우선순위·폐기·결과 정규화.

function toolCall(over: Partial<ChatMessage> = {}): ChatMessage {
  return { id: over.id ?? 'x', author: 'assistant', kind: MessageKind.TOOL_CALL, content: '', ...over }
}

describe('foldToolResult — 매칭 우선순위', () => {
  it('toolCallId 로 짝을 찾아 접는다', () => {
    const messages = [toolCall({ id: 'a', toolCallId: 'tc1' })]
    const out = foldToolResult(messages, { toolCallId: 'tc1', result: '내용', success: true })

    expect(out.folded).toBe(true)
    expect(out.messages[0]!.toolResult).toEqual({ message: '내용', raw: '내용', success: true })
  })

  it('같은 toolCallId 가 여러 개면 마지막(가장 최근) 것에 접는다', () => {
    const messages = [
      toolCall({ id: 'a', toolCallId: 'tc1' }),
      toolCall({ id: 'b', toolCallId: 'tc1' }),
    ]
    const out = foldToolResult(messages, { toolCallId: 'tc1', result: 'x' })
    expect(out.messages[1]!.toolResult).toBeDefined()
    expect(out.messages[0]!.toolResult).toBeUndefined()
  })

  it('toolCallId 가 없으면 같은 streamId 의 결과 없는 마지막 tool_call 에 접는다', () => {
    const messages = [toolCall({ id: 'a', streamId: 's1' })]
    const out = foldToolResult(messages, { result: '출력' }, 's1')
    expect(out.folded).toBe(true)
    expect(out.messages[0]!.toolResult?.message).toBe('출력')
  })

  it('streamId 폴백은 이미 결과가 접힌 tool_call 은 건너뛴다', () => {
    const messages = [
      toolCall({ id: 'a', streamId: 's1', toolResult: { message: '먼저' } }),
      toolCall({ id: 'b', streamId: 's1' }),
    ]
    const out = foldToolResult(messages, { result: '나중' }, 's1')
    expect(out.messages[1]!.toolResult?.message).toBe('나중')
    expect(out.messages[0]!.toolResult?.message).toBe('먼저')
  })

  it('toolCallId 가 있으면 streamId 폴백을 타지 않는다 (못 찾으면 폐기)', () => {
    const messages = [toolCall({ id: 'a', streamId: 's1' })]
    const out = foldToolResult(messages, { toolCallId: '없는id', result: 'x' }, 's1')
    expect(out.folded).toBe(false)
    expect(out.messages).toBe(messages) // 원본 그대로 반환
  })
})

describe('foldToolResult — 폐기 (유령 메시지 방지)', () => {
  it('짝이 없으면 folded:false 로 폐기한다', () => {
    const out = foldToolResult([], { toolCallId: 'tc1', result: 'x' })
    expect(out.folded).toBe(false)
    expect(out.messages).toHaveLength(0)
  })

  it('toolCallId 도 streamId 도 없으면 접을 대상이 없다', () => {
    const messages = [toolCall({ id: 'a', streamId: 's1' })]
    const out = foldToolResult(messages, { result: 'x' })
    expect(out.folded).toBe(false)
  })

  it('TOOL_CALL 이 아닌 메시지에는 접지 않는다', () => {
    const text: ChatMessage = { id: 't', author: 'assistant', kind: MessageKind.TEXT, content: '텍스트' }
    const out = foldToolResult([text], { toolCallId: 'tc1', result: 'x' })
    expect(out.folded).toBe(false)
  })
})

describe('foldToolResult — 결과 정규화', () => {
  it('객체 결과는 예쁘게 JSON 문자열로, raw 에는 원본을 담는다', () => {
    const messages = [toolCall({ toolCallId: 'tc1' })]
    const out = foldToolResult(messages, { toolCallId: 'tc1', result: { a: 1 } })
    const r = out.messages[0]!.toolResult!
    expect(r.message).toBe('{\n  "a": 1\n}')
    expect(r.raw).toEqual({ a: 1 })
  })

  it('result 가 undefined 면 message 도 raw 도 없다', () => {
    const messages = [toolCall({ toolCallId: 'tc1' })]
    const out = foldToolResult(messages, { toolCallId: 'tc1', result: undefined })
    const r = out.messages[0]!.toolResult!
    expect(r.message).toBeUndefined()
    expect('raw' in r).toBe(false)
  })

  it('result 가 null 이면 message 는 없지만 raw 에는 null 이 담긴다', () => {
    // extractMessage(null) → undefined 라 message 는 생략되나, null !== undefined 라 raw 는 채워진다
    const messages = [toolCall({ toolCallId: 'tc1' })]
    const out = foldToolResult(messages, { toolCallId: 'tc1', result: null })
    const r = out.messages[0]!.toolResult!
    expect(r.message).toBeUndefined()
    expect(r.raw).toBeNull()
  })

  it('error 가 있고 success 미지정이면 success:false', () => {
    const messages = [toolCall({ toolCallId: 'tc1' })]
    const out = foldToolResult(messages, { toolCallId: 'tc1', error: '권한 없음' })
    expect(out.messages[0]!.toolResult).toMatchObject({ success: false, error: '권한 없음' })
  })

  it('error 도 success 도 없으면 success:true 로 본다', () => {
    const messages = [toolCall({ toolCallId: 'tc1' })]
    const out = foldToolResult(messages, { toolCallId: 'tc1', result: 'ok' })
    expect(out.messages[0]!.toolResult?.success).toBe(true)
  })

  it('명시된 success 는 error 유무와 무관하게 보존한다', () => {
    const messages = [toolCall({ toolCallId: 'tc1' })]
    const out = foldToolResult(messages, { toolCallId: 'tc1', error: 'e', success: true })
    expect(out.messages[0]!.toolResult).toMatchObject({ success: true, error: 'e' })
  })

  it('접기는 원본 배열을 변형하지 않는다 (새 배열 반환)', () => {
    const messages = [toolCall({ toolCallId: 'tc1' })]
    const out = foldToolResult(messages, { toolCallId: 'tc1', result: 'x' })
    expect(out.messages).not.toBe(messages)
    expect(messages[0]!.toolResult).toBeUndefined()
  })
})
