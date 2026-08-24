// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AskAboutShell } from './TurnExtras'

// 셸 결과 넘기기 — 클릭이 곧 전송이 아니라 **덧붙일 말을 받는 칸**을 연다.
//
// 잠그는 것: 넘기기 전에 사용자가 끼어들 자리가 있다는 것, 그리고 그 자리가
// **빈 채로도 지나갈 수 있다는 것**(예전 동작). 찾는 것: 조합 확정 Enter 가
// 전송으로 새는 것 — 한글은 첫 글자 확정에서 걸리므로 덧말이 통째로 날아간다.

const SHELL = { command: 'npm test', output: '3 failed' }

afterEach(cleanup)

describe('덧붙일 말', () => {
  it('버튼을 눌러도 아직 넘어가지 않는다 — 입력 칸이 먼저 뜬다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)

    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    expect(onAsk).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: '덧붙일 말' })).toBeTruthy()
  })

  // 타이핑하러 마우스를 한 번 더 옮겨야 하면 그냥 빈 채로 보내게 된다
  it('입력 칸은 열리면서 초점을 가져간다', () => {
    render(<AskAboutShell shell={SHELL} onAsk={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '덧붙일 말' }))
  })

  it('쓴 말이 세 번째 인자로 함께 나간다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)
    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '왜 실패하나요?' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    expect(onAsk).toHaveBeenCalledWith('npm test', '3 failed', '왜 실패하나요?')
  })

  it('Enter 로도 나간다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)
    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '왜 실패하나요?' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAsk).toHaveBeenCalledWith('npm test', '3 failed', '왜 실패하나요?')
  })

  // 한글 첫 글자를 확정하는 Enter 가 전송이 되면 덧말을 아예 못 쓴다
  it('조합 확정 Enter 는 전송이 아니다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)
    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '왜' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(onAsk).not.toHaveBeenCalled()
  })
})

describe('빈 채로 보내기 — 예전 동작', () => {
  it('아무것도 안 쓰고 보내면 note 없이 나간다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)
    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    expect(onAsk).toHaveBeenCalledWith('npm test', '3 failed', undefined)
  })

  // 공백만 붙여 보내면 프롬프트 끝에 빈 줄만 달린다
  it('공백뿐인 말도 없는 것으로 친다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)
    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    expect(onAsk).toHaveBeenCalledWith('npm test', '3 failed', undefined)
  })
})

describe('나가는 길', () => {
  it('Escape 면 넘기지 않고 버튼으로 되돌아간다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)
    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '쓰다 만 말' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(onAsk).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '이 결과 물어보기' })).toBeTruthy()
  })

  // 취소하고 다시 열었더니 지난번에 쓰다 만 말이 남아 있으면 그대로 딸려 나간다
  it('취소한 말은 다시 열어도 남지 않는다', () => {
    render(<AskAboutShell shell={SHELL} onAsk={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '쓰다 만 말' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('')
  })
})

describe('한 번만 넘어간다', () => {
  it('보낸 뒤에는 버튼이 잠긴다', () => {
    const onAsk = vi.fn()
    render(<AskAboutShell shell={SHELL} onAsk={onAsk} />)
    fireEvent.click(screen.getByRole('button', { name: '이 결과 물어보기' }))
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    const done = screen.getByRole('button', { name: '넘겼습니다' }) as HTMLButtonElement
    expect(done.disabled).toBe(true)
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

// 넘길 곳이 없으면 버튼도 없다 (기존 동작)
describe('onAsk 가 없으면', () => {
  it('아무것도 그리지 않는다', () => {
    const { container } = render(<AskAboutShell shell={SHELL} />)

    expect(container.innerHTML).toBe('')
  })
})
