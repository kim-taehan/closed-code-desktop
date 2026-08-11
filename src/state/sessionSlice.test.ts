import { describe, expect, it } from 'vitest'
import { applyTurnEvent, EMPTY_SLICE, isBusy, type SessionSlice } from './sessionSlice'

// 프로젝트별 상태 전이. 여기서 섞이면 A 의 진행 표시가 B 에 뜬다.

function slice(overrides: Partial<SessionSlice> = {}): SessionSlice {
  return { ...EMPTY_SLICE, ...overrides }
}

describe('진행 표시 전이', () => {
  it('턴이 시작되면 요청 중이 된다', () => {
    const next = applyTurnEvent(slice(), { type: 'turn_started', turnId: 't1' })
    expect(next).toMatchObject({ isStreaming: true, mode: 'requesting' })
  })

  it('텍스트가 오면 응답 중으로 바뀌고 활동 신호가 오른다', () => {
    const next = applyTurnEvent(slice(), { type: 'text', turnId: 't1', text: '안녕' })
    expect(next.mode).toBe('responding')
    expect(next.activityKey).toBe(1)
  })

  it('도구 호출은 도구 사용으로 바뀐다', () => {
    const next = applyTurnEvent(slice(), { type: 'tool_call', turnId: 't1', toolName: 'read_file' })
    expect(next.mode).toBe('tool-use')
  })

  it('턴이 끝나면 멈추고 승인·질문·계획 대기도 지운다', () => {
    const busy = slice({
      isStreaming: true,
      mode: 'responding',
      approvals: [{ requestId: 'r1', toolName: 'edit_file' }],
      questions: [{ questionId: 'q1', question: '진행?' }],
      plans: [{ planId: 'p1', summary: '계획' }],
    })

    const next = applyTurnEvent(busy, { type: 'turn_ended', turnId: 't1', failed: false })
    expect(next).toMatchObject({ isStreaming: false, mode: 'idle', approvals: [], questions: [], plans: [] })
  })

  // Esc 로 중단하면 turn_ended 가 와서 이 경로로 카드가 정리된다 (cancelAndReset.test.ts:50,67 —
  // runtime 이 안 닫아줘도 5초 뒤 강제로 닫는다). **큐에 쌓인 것까지 전부** 비워야 한다 —
  // 하나만 지우면 다음 카드가 뜨면서 답할 턴도 없는 모달에 갇힌다.
  it('턴이 끝나면 큐에 쌓인 승인도 전부 비운다 — 답할 턴이 없는 카드가 남으면 안 된다', () => {
    const queued = slice({
      isStreaming: true,
      approvals: [
        { requestId: 'r1', toolName: 'edit_file' },
        { requestId: 'r2', toolName: 'run_command' },
        { requestId: 'r3', toolName: 'delete_file' },
      ],
    })

    const next = applyTurnEvent(queued, { type: 'turn_ended', turnId: 't1', failed: false })
    expect(next.approvals).toEqual([])
  })

  it('질문·계획 요청을 담고, 대기 중이면 바쁨으로 친다 (탭 배지)', () => {
    const asked = applyTurnEvent(slice(), {
      type: 'question_requested',
      turnId: 't1',
      questionId: 'q1',
      question: '어느 쪽?',
      options: ['A', 'B'],
    })
    expect(asked.questions).toEqual([{ questionId: 'q1', question: '어느 쪽?', options: ['A', 'B'] }])
    expect(isBusy(asked)).toBe(true)

    const planned = applyTurnEvent(slice(), {
      type: 'plan_requested',
      turnId: 't1',
      planId: 'p1',
      summary: '리팩토링',
      estimatedSteps: 2,
    })
    expect(planned.plans).toEqual([{ planId: 'p1', summary: '리팩토링', estimatedSteps: 2 }])
    expect(isBusy(planned)).toBe(true)
  })

  // runtime 은 병렬 task 로 인터럽트를 동시 여러 개 보낼 수 있다 (_pending_interrupts FIFO).
  // 단일 슬롯이면 둘째가 첫째를 덮어써 첫째 미응답으로 턴이 영영 멈춘다.
  it('질문이 연속으로 오면 큐에 쌓는다 (덮어쓰지 않는다)', () => {
    const one = applyTurnEvent(slice(), {
      type: 'question_requested',
      turnId: 't1',
      questionId: 'q1',
      question: '첫째?',
    })
    const two = applyTurnEvent(one, {
      type: 'question_requested',
      turnId: 't1',
      questionId: 'q2',
      question: '둘째?',
    })
    expect(two.questions.map((request) => request.questionId)).toEqual(['q1', 'q2'])
  })

  it('같은 질문이 재전송되면 무시한다', () => {
    const one = applyTurnEvent(slice(), {
      type: 'question_requested',
      turnId: 't1',
      questionId: 'q1',
      question: '진행?',
    })
    const again = applyTurnEvent(one, {
      type: 'question_requested',
      turnId: 't1',
      questionId: 'q1',
      question: '진행?',
    })
    expect(again.questions).toHaveLength(1)
  })

  it('계획이 연속으로 오면 큐에 쌓고, 재전송은 무시한다', () => {
    const one = applyTurnEvent(slice(), {
      type: 'plan_requested',
      turnId: 't1',
      planId: 'p1',
      summary: '첫 계획',
    })
    const two = applyTurnEvent(one, {
      type: 'plan_requested',
      turnId: 't1',
      planId: 'p2',
      summary: '둘째 계획',
    })
    expect(two.plans.map((request) => request.planId)).toEqual(['p1', 'p2'])

    const again = applyTurnEvent(two, {
      type: 'plan_requested',
      turnId: 't1',
      planId: 'p1',
      summary: '첫 계획',
    })
    expect(again.plans).toHaveLength(2)
  })

  it('승인 요청을 담는다', () => {
    const next = applyTurnEvent(slice(), {
      type: 'approval_requested',
      turnId: 't1',
      requestId: 'r1',
      toolName: 'run_command',
    })

    expect(next.approvals[0]).toMatchObject({ requestId: 'r1', toolName: 'run_command' })
  })

  it('한 턴에 승인 요청이 여러 개 오면 큐에 쌓는다 (덮어쓰지 않는다)', () => {
    const one = applyTurnEvent(slice(), {
      type: 'approval_requested',
      turnId: 't1',
      requestId: 'r1',
      toolName: 'run_command',
    })
    const two = applyTurnEvent(one, {
      type: 'approval_requested',
      turnId: 't1',
      requestId: 'r2',
      toolName: 'edit_file',
    })
    expect(two.approvals.map((request) => request.requestId)).toEqual(['r1', 'r2'])
  })

  it('같은 승인 요청이 재전송되면 무시한다', () => {
    const one = applyTurnEvent(slice(), {
      type: 'approval_requested',
      turnId: 't1',
      requestId: 'r1',
      toolName: 'run_command',
    })
    const again = applyTurnEvent(one, {
      type: 'approval_requested',
      turnId: 't1',
      requestId: 'r1',
      toolName: 'run_command',
    })
    expect(again.approvals).toHaveLength(1)
  })

  it('오류 이벤트는 상태를 건드리지 않는다', () => {
    const before = slice({ isStreaming: true })
    expect(applyTurnEvent(before, { type: 'error', message: '실패' })).toBe(before)
  })

  it('원본을 바꾸지 않는다 — 다른 프로젝트가 같은 객체를 볼 수 있다', () => {
    const before = slice()
    applyTurnEvent(before, { type: 'turn_started', turnId: 't1' })
    expect(before.isStreaming).toBe(false)
  })
})

describe('바쁨 판정 (탭 배지)', () => {
  it('턴이 도는 동안 바쁘다', () => {
    expect(isBusy(slice({ isStreaming: true }))).toBe(true)
  })

  // 승인 대기는 사용자가 손대야 진행된다 — 배지가 꺼지면 잊힌다
  it('승인 대기도 바쁨으로 본다', () => {
    expect(isBusy(slice({ approvals: [{ requestId: 'r1', toolName: 'edit_file' }] }))).toBe(true)
  })

  it('아무것도 안 하면 바쁘지 않다', () => {
    expect(isBusy(slice())).toBe(false)
  })

  it('세션이 없는 프로젝트는 바쁘지 않다', () => {
    expect(isBusy(undefined)).toBe(false)
  })
})
