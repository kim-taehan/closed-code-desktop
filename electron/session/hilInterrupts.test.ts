import { afterEach, describe, expect, it, vi } from 'vitest'
import { turnPausedForPlan, turnPausedForQuestion } from '../../tests/fake-runtime/turnScript'
import { connectAndHandshake, countOf, type SessionFixture } from '../../tests/fake-runtime/chatSessionKit'

// HIL 인터럽트(ask_user 질문 · 계획 승인) 왕복 (DC-644/776).
//
// 예전에는 이 두 청크를 버려서(user_question/plan_approval = DEFERRED) 에이전트가
// ask_user 를 부르면 턴이 조용히 영영 멈췄다. 이제 이벤트로 올리고 응답을 보낸다.

let fixture: SessionFixture | null = null

afterEach(async () => {
  await fixture?.dispose()
  fixture = null
})

describe('ask_user 질문', () => {
  it('질문 이벤트가 오고, 답하기 전에는 턴이 닫히지 않는다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) =>
        turnPausedForQuestion({ ...context, turnId: 'turn-1' }, 'q-1', '설정 파일을 고칠까요?', ['예', '아니오']),
    })

    fixture.chat.send('진행해줘')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'question_requested')).toBe(1))

    expect(fixture.events.find((event) => event.type === 'question_requested')).toMatchObject({
      questionId: 'q-1',
      question: '설정 파일을 고칠까요?',
      options: ['예', '아니오'],
    })
    // 답 대기 중 — 턴이 종료되면 안 된다 (설계 §4.4 terminal:false)
    expect(countOf(fixture.events, 'turn_ended')).toBe(0)
  })

  it('답이 user_answer 프레임(questionId·answer)으로 나간다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => turnPausedForQuestion({ ...context, turnId: 'turn-1' }, 'q-9', '어느 쪽?'),
    })

    fixture.chat.send('진행해줘')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'question_requested')).toBe(1))
    fixture.chat.respondQuestion('q-9', '왼쪽으로')

    await vi.waitFor(() => {
      const sent = fixture!.server.received.find((frame) => frame.action === 'user_answer')
      expect(sent?.data).toMatchObject({ questionId: 'q-9', answer: '왼쪽으로' })
    })
  })

  it('취소는 answer=null 로 나간다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => turnPausedForQuestion({ ...context, turnId: 'turn-1' }, 'q-2', '질문'),
    })

    fixture.chat.send('진행해줘')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'question_requested')).toBe(1))
    fixture.chat.respondQuestion('q-2', null)

    await vi.waitFor(() => {
      const sent = fixture!.server.received.find((frame) => frame.action === 'user_answer')
      expect(sent?.data).toMatchObject({ questionId: 'q-2', answer: null })
    })
  })

  it('autoApprove 세션이어도 질문은 사용자에게 올라온다 — 자동 응답 대상이 아니다', async () => {
    fixture = await connectAndHandshake(
      {
        onChatRequest: (context) => turnPausedForQuestion({ ...context, turnId: 'turn-1' }, 'q-3', '질문'),
      },
      { autoApprove: true },
    )

    fixture.chat.send('진행해줘')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'question_requested')).toBe(1))
    expect(fixture.server.received.some((frame) => frame.action === 'user_answer')).toBe(false)
  })
})

describe('계획 승인', () => {
  it('계획 이벤트가 요약·파일 목록·단계 수를 담는다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) =>
        turnPausedForPlan({ ...context, turnId: 'turn-1' }, 'p-1', '리팩토링 계획', {
          filesToChange: ['src/a.ts', 'src/b.ts'],
          estimatedSteps: 3,
        }),
    })

    fixture.chat.send('계획 세워줘')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'plan_requested')).toBe(1))

    expect(fixture.events.find((event) => event.type === 'plan_requested')).toMatchObject({
      planId: 'p-1',
      summary: '리팩토링 계획',
      filesToChange: ['src/a.ts', 'src/b.ts'],
      estimatedSteps: 3,
    })
    expect(countOf(fixture.events, 'turn_ended')).toBe(0)
  })

  it('승인이 plan_approval_response 프레임(planId·planApproved·planComment)으로 나간다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => turnPausedForPlan({ ...context, turnId: 'turn-1' }, 'p-9', '계획'),
    })

    fixture.chat.send('계획 세워줘')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'plan_requested')).toBe(1))
    fixture.chat.respondPlan('p-9', true, '2단계부터 신중히')

    await vi.waitFor(() => {
      const sent = fixture!.server.received.find((frame) => frame.action === 'plan_approval_response')
      expect(sent?.data).toMatchObject({ planId: 'p-9', planApproved: true, planComment: '2단계부터 신중히' })
    })
  })

  it('거부는 planApproved=false 로, 의견이 없으면 planComment 를 싣지 않는다', async () => {
    fixture = await connectAndHandshake({
      onChatRequest: (context) => turnPausedForPlan({ ...context, turnId: 'turn-1' }, 'p-2', '계획'),
    })

    fixture.chat.send('계획 세워줘')
    await vi.waitFor(() => expect(countOf(fixture!.events, 'plan_requested')).toBe(1))
    fixture.chat.respondPlan('p-2', false)

    await vi.waitFor(() => {
      const sent = fixture!.server.received.find((frame) => frame.action === 'plan_approval_response')
      expect(sent?.data).toMatchObject({ planId: 'p-2', planApproved: false })
      expect((sent?.data as Record<string, unknown>)['planComment']).toBeUndefined()
    })
  })
})
