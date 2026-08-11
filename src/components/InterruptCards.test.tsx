// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { InterruptCards } from './InterruptCards'
import type { QuestionRequest, PlanRequest } from '../state/sessionSlice'
import type { ApprovalRequest } from './ApprovalModal'

// HIL 인터럽트 카드 셋(도구 승인·질문·계획). 답하지 않으면 턴이 멈추므로
// 각 카드가 올바른 IPC(respondApproval/respondQuestion/respondPlan)를 부르고,
// 답한 뒤 resolve 콜백으로 카드를 내리는지 확인한다.

function stubDavis(overrides: Record<string, unknown> = {}) {
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = {
    respondApproval: vi.fn(() => Promise.resolve()),
    respondQuestion: vi.fn(() => Promise.resolve()),
    respondPlan: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
}

function resolveSpies() {
  return { resolveApproval: vi.fn(), resolveQuestion: vi.fn(), resolvePlan: vi.fn() }
}

beforeEach(() => stubDavis())
afterEach(cleanup)

describe('우선순위 — 승인 → 질문 → 계획', () => {
  it('아무 인터럽트도 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(
      <InterruptCards approvals={[]} question={null} plan={null} resolve={resolveSpies()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('승인이 있으면 질문·계획이 있어도 승인 모달을 먼저 보인다', () => {
    const approval: ApprovalRequest = { requestId: 'r1', toolName: 'edit_file' }
    const question: QuestionRequest = { questionId: 'q1', question: '질문?' }
    render(
      <InterruptCards approvals={[approval]} question={question} plan={null} resolve={resolveSpies()} />,
    )
    expect(screen.getByText('도구 실행 승인', { exact: false })).toBeDefined()
    expect(screen.queryByText('질문?')).toBeNull()
  })
})

describe('질문 카드', () => {
  const question: QuestionRequest = { questionId: 'q9', question: '설정을 고칠까요?', options: ['예', '아니오'] }

  it('선택지 버튼을 누르면 그 값으로 답하고 카드를 내린다', () => {
    const resolve = resolveSpies()
    render(<InterruptCards approvals={[]} question={question} plan={null} resolve={resolve} />)

    fireEvent.click(screen.getByText('예'))
    expect(window.davis.respondQuestion).toHaveBeenCalledWith({ questionId: 'q9', answer: '예' })
    // 답한 질문의 id 로 큐에서 뺀다 — 다음 대기 질문이 나온다
    expect(resolve.resolveQuestion).toHaveBeenCalledWith('q9')
  })

  it('자유 입력 후 답변 보내기', () => {
    const resolve = resolveSpies()
    render(<InterruptCards approvals={[]} question={question} plan={null} resolve={resolve} />)

    fireEvent.change(screen.getByPlaceholderText('직접 입력…'), { target: { value: '왼쪽으로' } })
    fireEvent.click(screen.getByText('답변 보내기'))
    expect(window.davis.respondQuestion).toHaveBeenCalledWith({ questionId: 'q9', answer: '왼쪽으로' })
  })

  it('취소는 answer=null 로 답한다', () => {
    const resolve = resolveSpies()
    render(<InterruptCards approvals={[]} question={question} plan={null} resolve={resolve} />)

    fireEvent.click(screen.getByText('취소'))
    expect(window.davis.respondQuestion).toHaveBeenCalledWith({ questionId: 'q9', answer: null })
    expect(resolve.resolveQuestion).toHaveBeenCalledWith('q9')
  })

  it('빈 입력이면 답변 보내기 버튼이 비활성이다', () => {
    render(<InterruptCards approvals={[]} question={question} plan={null} resolve={resolveSpies()} />)
    expect((screen.getByText('답변 보내기') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('계획 카드', () => {
  const plan: PlanRequest = {
    planId: 'p9',
    summary: '리팩토링 계획',
    filesToChange: ['src/a.ts', 'src/b.ts'],
    estimatedSteps: 3,
  }

  it('요약·변경 파일을 보이고, 승인 시 planId·approved·comment 로 답한다', () => {
    const resolve = resolveSpies()
    render(<InterruptCards approvals={[]} question={null} plan={plan} resolve={resolve} />)

    expect(screen.getByText('리팩토링 계획')).toBeDefined()
    expect(screen.getByText('src/a.ts')).toBeDefined()

    fireEvent.change(screen.getByPlaceholderText('의견 (선택)…'), { target: { value: '신중히' } })
    fireEvent.click(screen.getByText('계획 승인'))
    expect(window.davis.respondPlan).toHaveBeenCalledWith({ planId: 'p9', approved: true, comment: '신중히' })
    expect(resolve.resolvePlan).toHaveBeenCalledWith('p9')
  })

  it('의견이 없으면 comment 없이 거부한다', () => {
    const resolve = resolveSpies()
    render(<InterruptCards approvals={[]} question={null} plan={plan} resolve={resolve} />)

    fireEvent.click(screen.getByText('거부'))
    expect(window.davis.respondPlan).toHaveBeenCalledWith({ planId: 'p9', approved: false })
  })
})
