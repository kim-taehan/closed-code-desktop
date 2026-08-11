import { describe, expect, it } from 'vitest'
import { MessageKind } from '../../shared/ipc/messageTypes'
import { MessageStore } from './messageStore'

// 메시지 배열 조립 (설계 §5.1). 세그먼트 병합·tool_result 접기·에러·리셋 엣지케이스.

describe('MessageStore — addUserMessage', () => {
  it('user TEXT 메시지를 추가하고 반환한다', () => {
    const store = new MessageStore()
    const msg = store.addUserMessage('안녕')
    expect(msg).toMatchObject({ author: 'user', kind: MessageKind.TEXT, content: '안녕' })
    expect(msg.id).toBeTruthy()
    expect(store.messages).toHaveLength(1)
  })

  it('첨부가 있으면 담고, 없으면 필드 자체를 넣지 않는다', () => {
    const store = new MessageStore()
    const withAtt = store.addUserMessage('a', [{ name: 'x.png', kind: 'image' }])
    expect(withAtt.attachments).toEqual([{ name: 'x.png', kind: 'image' }])
    const noAtt = store.addUserMessage('b')
    expect('attachments' in noAtt).toBe(false)
  })
})

describe('MessageStore — appendText 세그먼트 병합', () => {
  it('같은 (streamId, segmentId) 의 assistant TEXT 는 이어붙인다', () => {
    const store = new MessageStore()
    store.appendText({ text: '첫 ', streamId: 's', segmentId: 'g' })
    store.appendText({ text: '둘', streamId: 's', segmentId: 'g' })
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]!.content).toBe('첫 둘')
  })

  it('segmentId 가 바뀌면 새 버블', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a', streamId: 's', segmentId: 'g1' })
    store.appendText({ text: 'b', streamId: 's', segmentId: 'g2' })
    expect(store.messages).toHaveLength(2)
  })

  it('streamId 가 바뀌면 새 버블', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a', streamId: 's1', segmentId: 'g' })
    store.appendText({ text: 'b', streamId: 's2', segmentId: 'g' })
    expect(store.messages).toHaveLength(2)
  })

  it('streamId·segmentId 가 둘 다 없으면 서로 병합된다 (현재 동작)', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a' })
    store.appendText({ text: 'b' })
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]!.content).toBe('ab')
  })

  it('직전이 user 메시지면 병합하지 않고 새 assistant 버블', () => {
    const store = new MessageStore()
    store.addUserMessage('질문')
    store.appendText({ text: '답' })
    expect(store.messages).toHaveLength(2)
    expect(store.messages[1]!.author).toBe('assistant')
  })

  it('직전이 tool_call 이면 병합하지 않는다', () => {
    const store = new MessageStore()
    store.addToolCall({ toolName: 'read_file' })
    store.appendText({ text: '답', streamId: 's', segmentId: 'g' })
    expect(store.messages).toHaveLength(2)
  })

  it('나중에 온 semanticType 은 비어 있을 때만 채운다', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a', streamId: 's', segmentId: 'g' })
    store.appendText({ text: 'b', streamId: 's', segmentId: 'g', semanticType: 'reply' })
    expect(store.messages[0]!.semanticType).toBe('reply')
  })

  it('이미 semanticType 이 있으면 덮어쓰지 않는다', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a', streamId: 's', segmentId: 'g', semanticType: 'reply' })
    store.appendText({ text: 'b', streamId: 's', segmentId: 'g', semanticType: 'plan' })
    expect(store.messages[0]!.semanticType).toBe('reply')
  })

  it('turnId 를 새 버블에 찍는다', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a', turnId: 't1', streamId: 's', segmentId: 'g' })
    expect(store.messages[0]!.turnId).toBe('t1')
  })
})

describe('MessageStore — addToolCall', () => {
  it('도구 이름·timestamp 를 담고 결과는 비어 있다', () => {
    const store = new MessageStore()
    store.addToolCall({ toolName: 'grep_search', toolCallId: 'tc1', toolArgs: { pattern: 'x' } })
    const msg = store.messages[0]!
    expect(msg).toMatchObject({ kind: MessageKind.TOOL_CALL, toolName: 'grep_search', toolCallId: 'tc1' })
    expect(msg.toolArgs).toEqual({ pattern: 'x' })
    expect(msg.timestamp).toBeTruthy()
    expect(msg.toolResult).toBeUndefined()
  })

  it('toolCallId·toolArgs 는 없으면 필드를 넣지 않는다', () => {
    const store = new MessageStore()
    store.addToolCall({ toolName: 'run_command' })
    const msg = store.messages[0]!
    expect('toolCallId' in msg).toBe(false)
    expect('toolArgs' in msg).toBe(false)
  })
})

describe('MessageStore — applyToolResult 접기', () => {
  it('toolCallId 로 짝을 찾아 접고 true 를 반환한다', () => {
    const store = new MessageStore()
    store.addToolCall({ toolName: 'read_file', toolCallId: 'tc1' })
    const folded = store.applyToolResult({ toolCallId: 'tc1', result: '내용', success: true })
    expect(folded).toBe(true)
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]!.toolResult).toMatchObject({ message: '내용', success: true })
  })

  it('짝이 없으면 폐기하고 false 를 반환한다 (유령 메시지 없음)', () => {
    const store = new MessageStore()
    const folded = store.applyToolResult({ toolCallId: '없음', result: 'x' })
    expect(folded).toBe(false)
    expect(store.messages).toHaveLength(0)
  })

  it('toolCallId 없이 streamId 로 미완료 도구에 접는다', () => {
    const store = new MessageStore()
    store.addToolCall({ toolName: 'run_command', streamId: 's1' })
    expect(store.applyToolResult({ result: '출력' }, 's1')).toBe(true)
    expect(store.messages[0]!.toolResult?.message).toBe('출력')
  })
})

describe('MessageStore — markLastAsShell', () => {
  it('마지막 메시지에 shell 원문을 붙인다', () => {
    const store = new MessageStore()
    store.appendText({ text: '```출력```' })
    store.markLastAsShell('ls', '출력')
    expect(store.messages[0]!.shell).toEqual({ command: 'ls', output: '출력' })
  })

  it('메시지가 없으면 아무 일도 하지 않는다', () => {
    const store = new MessageStore()
    store.markLastAsShell('ls', 'x')
    expect(store.messages).toHaveLength(0)
  })
})

describe('MessageStore — addError / lastIsError', () => {
  it('code 가 있으면 (code) 를 붙인다', () => {
    const store = new MessageStore()
    store.addError({ message: '실패', code: 'E1', turnId: 't1' })
    expect(store.messages[0]!).toMatchObject({ kind: MessageKind.ERROR, content: '실패 (E1)', turnId: 't1' })
  })

  it('code 가 없으면 메시지만', () => {
    const store = new MessageStore()
    store.addError({ message: '실패' })
    expect(store.messages[0]!.content).toBe('실패')
  })

  it('카탈로그에 있는 코드는 사용자 문구로 바꾸고 코드값을 감춘다', () => {
    const store = new MessageStore()
    store.addError({ message: '요청을 처리하지 못했습니다', code: 'OPENAI_BADREQUEST', turnId: 't1' })
    const content = store.messages[0]!.content
    expect(content).toBe(
      'AI 모델 요청 오류\nAI 모델이 요청을 처리하지 못했습니다. 반복되면 관리자에게 문의하세요.',
    )
    // 내부 식별자가 사용자 앞에 남으면 안 된다
    expect(content).not.toContain('OPENAI_BADREQUEST')
  })

  it('소문자 코드도 카탈로그에 맞춘다', () => {
    const store = new MessageStore()
    store.addError({ message: '실패', code: 'auth_key_expired' })
    expect(store.messages[0]!.content).toContain('라이선스 만료')
  })

  it('카탈로그에 없는 코드는 기존 동작 그대로 — 원문 + (코드)', () => {
    const store = new MessageStore()
    store.addError({ message: '알 수 없는 실패', code: 'RUNTIME_ONLY_CODE' })
    expect(store.messages[0]!.content).toBe('알 수 없는 실패 (RUNTIME_ONLY_CODE)')
  })

  it('lastIsError 는 마지막이 에러일 때만 true', () => {
    const store = new MessageStore()
    expect(store.lastIsError()).toBe(false)
    store.addError({ message: 'e' })
    expect(store.lastIsError()).toBe(true)
    store.appendText({ text: '다음' })
    expect(store.lastIsError()).toBe(false)
  })
})

describe('MessageStore — reviseSemanticType', () => {
  it('기존 TEXT 버블의 semanticType 만 바꾸고 true 반환', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a', streamId: 's', segmentId: 'g' })
    expect(store.reviseSemanticType('g', 'reply')).toBe(true)
    expect(store.messages[0]!.semanticType).toBe('reply')
  })

  it('이미 같은 값이면 false (변경 없음)', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a', streamId: 's', segmentId: 'g', semanticType: 'reply' })
    expect(store.reviseSemanticType('g', 'reply')).toBe(false)
  })

  it('없는 segmentId 면 false', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a', segmentId: 'g' })
    expect(store.reviseSemanticType('없음', 'reply')).toBe(false)
  })

  it('뒤에서부터 찾는다 — segmentId 충돌 시 최신 버블만', () => {
    const store = new MessageStore()
    store.appendText({ text: '옛', streamId: 's1', segmentId: 'g' })
    store.appendText({ text: '새', streamId: 's2', segmentId: 'g' })
    store.reviseSemanticType('g', 'reply')
    expect(store.messages[0]!.semanticType).toBeUndefined()
    expect(store.messages[1]!.semanticType).toBe('reply')
  })
})

describe('MessageStore — markInterrupted', () => {
  it('활성 턴의 마지막 assistant 메시지를 중단으로 표시', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a', turnId: 't1' })
    expect(store.markInterrupted('t1')).toBe(true)
    expect(store.messages[0]!.interrupted).toBe(true)
  })

  it('turnId 가 null 이면 턴 무관하게 마지막 assistant 를 표시', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a', turnId: 't1' })
    expect(store.markInterrupted(null)).toBe(true)
    expect(store.messages[0]!.interrupted).toBe(true)
  })

  it('turnId 가 안 맞으면 user 만 있어도 false', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a', turnId: 't1' })
    expect(store.markInterrupted('t2')).toBe(false)
  })

  it('assistant 메시지가 없으면 false', () => {
    const store = new MessageStore()
    store.addUserMessage('질문')
    expect(store.markInterrupted(null)).toBe(false)
  })
})

describe('MessageStore — snapshot / reset / immutability', () => {
  it('snapshot 은 복제본이라 밖에서 밀어넣어도 원본은 안 바뀐다', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a' })
    const snap = store.snapshot()
    snap.push({ id: 'z', author: 'user', kind: MessageKind.TEXT, content: 'x' })
    expect(store.messages).toHaveLength(1)
  })

  it('reset 은 전부 비운다', () => {
    const store = new MessageStore()
    store.appendText({ text: 'a' })
    store.reset()
    expect(store.messages).toHaveLength(0)
  })
})
