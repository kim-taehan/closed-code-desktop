// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AskAboutShell } from './TurnExtras'

// 셸 결과 넘기기 — 덧붙일 칸이 **결과 밑에 처음부터 떠 있다.**
//
// 잠그는 것: 한 번의 클릭(또는 Enter)으로 넘어간다는 것, 그 칸을 **빈 채로도 지나갈 수
// 있다는 것**(예전 동작), 그리고 늘 떠 있으면서도 **초점을 뺏지 않는다는 것**.
// 찾는 것: 조합 확정 Enter 가 전송으로 새는 것 — 한글은 첫 글자 확정에서 걸리므로
// 덧말이 통째로 날아간다.

const SHELL = { command: 'npm test', output: '3 failed' }

afterEach(cleanup)

describe('덧붙일 말', () => {
  it('결과 밑에 입력칸과 버튼이 함께 떠 있다 — 여는 단계가 없다', () => {
    render(<AskAboutShell shell={SHELL} onAsk={vi.fn()} />)

    expect(screen.getByRole('textbox', { name: '덧붙일 말' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '이 결과 물어보기' })).toBeTruthy()
  })

  // 셸을 돌릴 때마다 이 칸이 하나씩 생긴다. 늘 떠 있는 칸이 초점을 빼앗으면
  // 아래 입력창에 쓰던 글이 엉뚱한 칸으로 들어간다
  it('떠 있기만 하고 초점은 가져가지 않는다', () => {
    render(<AskAboutShell shell={SHELL} onAsk={vi.fn()} />)

    expect(document.activeElement).not.toBe(screen.getByRole('textbox'))
  })

  it('쓴 말이 세 번째 인자로 함께 나간다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '왜 실패하나요?' } })
    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    expect(onAsk).toHaveBeenCalledWith('npm test', '3 failed', '왜 실패하나요?')
  })

  it('Enter 로도 나간다 — 손을 마우스로 옮기지 않는다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '왜 실패하나요?' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAsk).toHaveBeenCalledWith('npm test', '3 failed', '왜 실패하나요?')
  })

  // 한글 첫 글자를 확정하는 Enter 가 전송이 되면 덧말을 아예 못 쓴다
  it('조합 확정 Enter 는 전송이 아니다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '왜' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(onAsk).not.toHaveBeenCalled()
  })
})

describe('빈 채로 넘기기 — 예전 동작', () => {
  it('아무것도 안 쓰고 눌러도 그대로 넘어간다 (note 없이)', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)

    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    expect(onAsk).toHaveBeenCalledWith('npm test', '3 failed', undefined)
  })

  // 공백만 붙여 보내면 프롬프트 끝에 빈 줄만 달린다
  it('공백뿐인 말도 없는 것으로 친다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    expect(onAsk).toHaveBeenCalledWith('npm test', '3 failed', undefined)
  })
})

describe('Escape', () => {
  // 접을 칸이 없어졌으니 Escape 에 남은 일은 쓰던 말을 지우는 것뿐이다.
  // 이때 넘어가 버리면 취소하려던 사람이 되돌릴 수 없는 것을 보낸다
  it('쓰던 말만 지우고 넘기지 않는다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '쓰다 만 말' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onAsk).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('')
  })
})

describe('한 번만 넘어간다', () => {
  it('넘긴 뒤에는 칸도 버튼도 거둔다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)

    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    const done = screen.getByRole('button', { name: '넘겼습니다' }) as HTMLButtonElement
    expect(done.disabled).toBe(true)
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

// 넘길 곳이 없으면 칸도 없다 (기존 동작)
describe('onAsk 가 없으면', () => {
  it('아무것도 그리지 않는다', () => {
    const { container } = render(<AskAboutShell shell={SHELL} />)

    expect(container.innerHTML).toBe('')
  })
})
