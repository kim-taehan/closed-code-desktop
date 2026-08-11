import { describe, expect, it } from 'vitest'
import { parseInterrupt, interruptTurnEvents } from './interrupts'

// 인터럽트 청크 파싱과 이벤트 변환 (DC-644/776).
//
// hilInterrupts.test.ts 는 소켓 왕복(통합)을 본다. 여기서는 순수 함수 두 개의
// 경계(필수 필드 누락·자동승인 분기)를 직접 찌른다.

describe('parseInterrupt — 도구 승인', () => {
  it('requestId·toolName·args·reason·displayName 을 뽑는다', () => {
    const parsed = parseInterrupt({
      messageType: 'tool_approval_request',
      requestId: 'r1',
      toolName: 'edit_file',
      args: { path: 'a.ts' },
      reason: '버그 수정',
      displayName: '파일 편집',
    })
    expect(parsed.approval).toEqual({
      requestId: 'r1',
      toolName: 'edit_file',
      args: { path: 'a.ts' },
      reason: '버그 수정',
      displayName: '파일 편집',
    })
    expect(parsed.question).toBeUndefined()
    expect(parsed.plan).toBeUndefined()
  })

  it('requestId 가 없으면 아무것도 뽑지 않는다', () => {
    expect(parseInterrupt({ messageType: 'tool_approval_request', toolName: 'x' })).toEqual({})
  })

  it('toolName 이 없으면 "알 수 없는 도구" 로 채운다', () => {
    const parsed = parseInterrupt({ messageType: 'tool_approval_request', requestId: 'r1' })
    expect(parsed.approval?.toolName).toBe('알 수 없는 도구')
  })
})

describe('parseInterrupt — ask_user 질문', () => {
  it('questionId·question·options 를 뽑는다', () => {
    const parsed = parseInterrupt({
      messageType: 'user_question',
      questionId: 'q1',
      question: '진행할까요?',
      options: ['예', '아니오'],
    })
    expect(parsed.question).toEqual({ questionId: 'q1', question: '진행할까요?', options: ['예', '아니오'] })
  })

  it('question 이 비면 message 로 대체한다', () => {
    const parsed = parseInterrupt({ messageType: 'user_question', questionId: 'q1', message: '대체 질문' })
    expect(parsed.question?.question).toBe('대체 질문')
  })

  it('questionId 나 질문 문구가 없으면 뽑지 않는다', () => {
    expect(parseInterrupt({ messageType: 'user_question', question: '질문만' }).question).toBeUndefined()
    expect(parseInterrupt({ messageType: 'user_question', questionId: 'q1' }).question).toBeUndefined()
  })

  it('빈 옵션 배열은 options 를 아예 싣지 않는다', () => {
    const parsed = parseInterrupt({ messageType: 'user_question', questionId: 'q1', question: '?', options: [] })
    expect(parsed.question).toEqual({ questionId: 'q1', question: '?' })
    expect('options' in parsed.question!).toBe(false)
  })

  it('문자열이 아닌 옵션은 걸러낸다', () => {
    const parsed = parseInterrupt({
      messageType: 'user_question',
      questionId: 'q1',
      question: '?',
      options: ['예', 3, null, '아니오'],
    })
    expect(parsed.question?.options).toEqual(['예', '아니오'])
  })
})

describe('parseInterrupt — 계획 승인', () => {
  it('planId·summary·filesToChange·estimatedSteps 를 뽑는다', () => {
    const parsed = parseInterrupt({
      messageType: 'plan_approval',
      planId: 'p1',
      summary: '리팩토링',
      filesToChange: ['a.ts', 'b.ts'],
      estimatedSteps: 3,
    })
    expect(parsed.plan).toEqual({
      planId: 'p1',
      summary: '리팩토링',
      filesToChange: ['a.ts', 'b.ts'],
      estimatedSteps: 3,
    })
  })

  it('planId 가 없으면 뽑지 않는다', () => {
    expect(parseInterrupt({ messageType: 'plan_approval', summary: 'x' }).plan).toBeUndefined()
  })

  it('summary 가 없으면 빈 문자열, 선택 필드는 생략한다', () => {
    const parsed = parseInterrupt({ messageType: 'plan_approval', planId: 'p1' })
    expect(parsed.plan).toEqual({ planId: 'p1', summary: '' })
  })
})

describe('interruptTurnEvents — 이벤트 변환', () => {
  it('승인은 approval_requested 이벤트가 된다', () => {
    const events = interruptTurnEvents(
      { approval: { requestId: 'r1', toolName: 'edit_file', args: { a: 1 } } },
      'turn-1',
      false,
    )
    expect(events).toEqual([
      { type: 'approval_requested', turnId: 'turn-1', requestId: 'r1', toolName: 'edit_file', args: { a: 1 } },
    ])
  })

  it('skipApproval 이면 승인 이벤트를 내지 않는다 (autoApprove 는 이미 응답했다)', () => {
    const events = interruptTurnEvents(
      { approval: { requestId: 'r1', toolName: 'edit_file' } },
      'turn-1',
      true,
    )
    expect(events).toEqual([])
  })

  it('질문·계획은 skipApproval 과 무관하게 항상 이벤트가 된다', () => {
    const parsed = {
      question: { questionId: 'q1', question: '?' },
      plan: { planId: 'p1', summary: '계획' },
    }
    const events = interruptTurnEvents(parsed, 'turn-1', true)
    expect(events).toEqual([
      { type: 'question_requested', turnId: 'turn-1', questionId: 'q1', question: '?' },
      { type: 'plan_requested', turnId: 'turn-1', planId: 'p1', summary: '계획' },
    ])
  })

  it('빈 파싱 결과는 이벤트가 없다', () => {
    expect(interruptTurnEvents({}, 'turn-1', false)).toEqual([])
  })
})
