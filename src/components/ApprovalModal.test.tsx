// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ApprovalModal } from './ApprovalModal'

// 도구 실행 승인 모달. 응답하지 않으면 턴이 멈추므로 닫기는 없다 —
// 허용/거부 중 하나를 고르거나, 제한시간이 지나면 자동 거부한다.

afterEach(cleanup)
beforeEach(() => vi.useRealTimers())

const request = {
  requestId: 'r1',
  toolName: 'list_directory',
  args: { path: '/Users/user/develop' },
  reason: '정책에 따라 list_directory 시 사용자 승인이 필요합니다.',
}

describe('승인 모달', () => {
  it('도구 이름과 사유를 보여준다', () => {
    render(<ApprovalModal request={request} onRespond={() => {}} />)
    expect(screen.getByText('list_directory')).toBeTruthy()
    expect(screen.getByText(request.reason)).toBeTruthy()
  })

  it('displayName 이 있으면 그걸 도구 이름 대신 쓴다', () => {
    render(<ApprovalModal request={{ ...request, displayName: '디렉토리 보기' }} onRespond={() => {}} />)
    expect(screen.getByText('디렉토리 보기')).toBeTruthy()
  })

  it('닫기 버튼이 없다 — 무응답으로 빠져나갈 수 없어야 한다', () => {
    const { container } = render(<ApprovalModal request={request} onRespond={() => {}} />)
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent)
    expect(buttons).not.toContain('닫기')
    expect(buttons).not.toContain('×')
  })

  it('이번만 허용은 followUp 없이 승인한다', () => {
    const onRespond = vi.fn()
    render(<ApprovalModal request={request} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('승인'))
    expect(onRespond).toHaveBeenCalledWith('r1', true, undefined)
  })

  it('세션 자동 승인은 session_allow 를 보낸다', () => {
    const onRespond = vi.fn()
    render(<ApprovalModal request={request} onRespond={onRespond} />)
    fireEvent.click(screen.getByLabelText('이 세션 동안 자동 승인'))
    fireEvent.click(screen.getByText('승인'))
    expect(onRespond).toHaveBeenCalledWith('r1', true, 'session_allow')
  })

  it('이 PC 항상 허용은 local_allow 를 보낸다', () => {
    const onRespond = vi.fn()
    render(<ApprovalModal request={request} onRespond={onRespond} />)
    fireEvent.click(screen.getByLabelText('이 PC에서 항상 허용'))
    fireEvent.click(screen.getByText('승인'))
    expect(onRespond).toHaveBeenCalledWith('r1', true, 'local_allow')
  })

  it('거부는 범위와 무관하게 approved:false', () => {
    const onRespond = vi.fn()
    render(<ApprovalModal request={request} onRespond={onRespond} />)
    fireEvent.click(screen.getByLabelText('이 PC에서 항상 허용'))
    fireEvent.click(screen.getByText('거부'))
    expect(onRespond).toHaveBeenCalledWith('r1', false)
  })

  // 인자에 줄바꿈이 있으면 \n 리터럴 대신 실제 줄로 편다
  it('인자의 줄바꿈을 실제 줄로 보여준다', () => {
    render(
      <ApprovalModal request={{ ...request, args: { description: '첫 줄\n둘째 줄' } }} onRespond={() => {}} />,
    )
    fireEvent.click(screen.getByText('▼ 인자 보기'))
    const pre = document.querySelector('.approval-card-args')!
    expect(pre.textContent).toContain('첫 줄\n둘째 줄')
    expect(pre.textContent).not.toContain('\\n')
  })

  it('제한시간이 지나면 자동 거부한다', () => {
    vi.useFakeTimers()
    const onRespond = vi.fn()
    render(<ApprovalModal request={request} onRespond={onRespond} />)

    vi.advanceTimersByTime(15_000)
    expect(onRespond).toHaveBeenCalledWith('r1', false)
    vi.useRealTimers()
  })
})
