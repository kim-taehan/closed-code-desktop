// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Composer } from './Composer'

// 입력창의 계약: 전송 트리거(Enter), 줄바꿈(Shift+Enter),
// 초기화(Esc 두 번 연속), IME 조합 중 오전송 방지.

afterEach(cleanup)

function setup(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSubmit = vi.fn()
  const view = render(<Composer onSubmit={onSubmit} {...props} />)
  const textarea = view.container.querySelector('textarea')!
  return { ...view, onSubmit, textarea }
}

const type = (textarea: HTMLTextAreaElement, value: string) =>
  fireEvent.change(textarea, { target: { value } })

describe('화살표 소유권', () => {
  // ⌘↑ 는 셸 드로어 것이다. preventDefault 는 전파를 막지 않으므로, 입력창이 수식키를
  // 안 보면 **드로어가 열리면서 쓰던 글까지 이전 프롬프트로 바뀐다.**
  it('⌘↑ 는 히스토리를 건드리지 않는다', () => {
    const { textarea } = setup({ history: ['이전 프롬프트'] })
    type(textarea, '쓰던 글')
    fireEvent.keyDown(textarea, { key: 'ArrowUp', metaKey: true })
    expect(textarea.value).toBe('쓰던 글')
  })

  it('맨 ↑ 는 그대로 히스토리로 간다', () => {
    const { textarea } = setup({ history: ['이전 프롬프트'] })
    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(textarea.value).toBe('이전 프롬프트')
  })
})

describe('기본 형태', () => {
  it('기존 .composer 클래스를 그대로 쓴다', () => {
    const { container } = setup()
    expect(container.querySelector('.composer')).toBeTruthy()
  })

  it('input 이 아니라 여러 줄 입력이 가능한 textarea 다', () => {
    const { container } = setup()
    expect(container.querySelector('textarea')).toBeTruthy()
    expect(container.querySelector('input')).toBeNull()
  })

  it('준비됐으면 입력을 권하는 placeholder 를 보여준다', () => {
    const { textarea } = setup()
    expect(textarea.placeholder).toBe('메시지를 입력하세요…')
  })

  it('준비 안 됐으면 placeholder 는 "연결을 기다리는 중…" 이고 입력이 막힌다', () => {
    const { textarea } = setup({ disabled: true })
    expect(textarea.placeholder).toBe('연결을 기다리는 중…')
    expect(textarea.disabled).toBe(true)
  })
})

describe('전송 버튼', () => {
  it('라벨은 "전송" 이다', () => {
    setup()
    expect(screen.getByRole('button', { name: '전송' })).toBeTruthy()
  })

  it('입력이 비었으면 누를 수 없다', () => {
    setup()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '전송' }).disabled).toBe(true)
  })

  it('공백만 있는 입력도 비어 있는 것으로 본다', () => {
    const { textarea } = setup()
    type(textarea, '   ')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '전송' }).disabled).toBe(true)
  })

  it('준비 안 됐으면 내용이 있어도 누를 수 없다', () => {
    const { textarea } = setup({ disabled: true })
    type(textarea, '안녕')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '전송' }).disabled).toBe(true)
  })

  it('누르면 앞뒤 공백을 제거한 텍스트가 전달되고 입력창이 비워진다', () => {
    const { textarea, onSubmit } = setup()
    type(textarea, '  안녕  ')
    fireEvent.click(screen.getByRole('button', { name: '전송' }))

    expect(onSubmit).toHaveBeenCalledWith('안녕')
    expect(textarea.value).toBe('')
  })
})

describe('Enter 키', () => {
  it('Enter 로 전송된다', () => {
    const { textarea, onSubmit } = setup()
    type(textarea, '안녕')
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSubmit).toHaveBeenCalledWith('안녕')
    expect(textarea.value).toBe('')
  })

  it('Shift+Enter 는 전송하지 않는다 — 줄바꿈은 브라우저 기본 동작에 맡긴다', () => {
    const { textarea, onSubmit } = setup()
    type(textarea, '첫 줄')
    const notPrevented = fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(textarea.value).toBe('첫 줄')
    // preventDefault 를 하면 줄바꿈이 들어가지 않는다
    expect(notPrevented).toBe(true)
  })

  it('여러 줄 입력을 그대로 전송한다', () => {
    const { textarea, onSubmit } = setup()
    type(textarea, '첫 줄\n둘째 줄')
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSubmit).toHaveBeenCalledWith('첫 줄\n둘째 줄')
  })

  it('IME 조합 중 Enter 는 무시한다 — 한글 조합 확정이 전송으로 새면 안 된다', () => {
    const { textarea, onSubmit } = setup()
    type(textarea, '한글')
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(textarea.value).toBe('한글')
  })

  it('빈 입력에서 Enter 를 눌러도 전송되지 않는다', () => {
    const { textarea, onSubmit } = setup()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('준비 안 된 상태에서는 Enter 로도 전송되지 않는다', () => {
    const { textarea, onSubmit } = setup({ disabled: true })
    type(textarea, '안녕')
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('Esc 두 번 연속 초기화', () => {
  const escape = (textarea: HTMLTextAreaElement) => fireEvent.keyDown(textarea, { key: 'Escape' })

  it('연속 두 번이면 입력창이 비워진다', () => {
    const { textarea } = setup()
    type(textarea, '지울 내용')

    escape(textarea)
    expect(textarea.value).toBe('지울 내용')

    escape(textarea)
    expect(textarea.value).toBe('')
  })

  it('한 번만으로는 비워지지 않는다', () => {
    const { textarea } = setup()
    type(textarea, '지울 내용')
    escape(textarea)
    expect(textarea.value).toBe('지울 내용')
  })

  it('두 Esc 사이에 다른 키가 끼면 카운트가 초기화된다', () => {
    const { textarea } = setup()
    type(textarea, '지울 내용')

    escape(textarea)
    fireEvent.keyDown(textarea, { key: 'a' })
    escape(textarea)

    expect(textarea.value).toBe('지울 내용')
  })

  it('중간에 다른 키가 끼었어도 그 뒤로 Esc 를 두 번 더 누르면 비워진다', () => {
    const { textarea } = setup()
    type(textarea, '지울 내용')

    escape(textarea)
    fireEvent.keyDown(textarea, { key: 'a' })
    escape(textarea)
    escape(textarea)

    expect(textarea.value).toBe('')
  })

  it('1000ms 를 넘겨서 누르면 초기화되지 않는다', () => {
    vi.useFakeTimers()
    const { textarea } = setup()
    type(textarea, '지울 내용')

    escape(textarea)
    vi.setSystemTime(Date.now() + 1001)
    escape(textarea)

    expect(textarea.value).toBe('지울 내용')
    vi.useRealTimers()
  })

  it('1000ms 경계는 초기화된다', () => {
    vi.useFakeTimers()
    const { textarea } = setup()
    type(textarea, '지울 내용')

    escape(textarea)
    vi.setSystemTime(Date.now() + 1000)
    escape(textarea)

    expect(textarea.value).toBe('')
    vi.useRealTimers()
  })

  it('시간이 지나 끊긴 뒤에도 다시 두 번 누르면 비워진다', () => {
    vi.useFakeTimers()
    const { textarea } = setup()
    type(textarea, '지울 내용')

    escape(textarea)
    vi.setSystemTime(Date.now() + 5000)
    escape(textarea)
    escape(textarea)

    expect(textarea.value).toBe('')
    vi.useRealTimers()
  })

  it('입력이 비어 있으면 Esc 두 번에도 아무 일도 하지 않는다', () => {
    const { textarea, onSubmit } = setup()

    escape(textarea)
    escape(textarea)

    expect(textarea.value).toBe('')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Esc 로 비운 뒤에는 전송 버튼이 다시 잠긴다', () => {
    const { textarea } = setup()
    type(textarea, '지울 내용')
    escape(textarea)
    escape(textarea)

    expect(screen.getByRole<HTMLButtonElement>('button', { name: '전송' }).disabled).toBe(true)
  })
})

describe('높이 자동 확장', () => {
  /** jsdom 은 레이아웃을 계산하지 않으므로 scrollHeight 를 직접 흉내낸다 */
  function withScrollHeight(px: number, run: () => void) {
    const proto = window.HTMLTextAreaElement.prototype
    const original = Object.getOwnPropertyDescriptor(proto, 'scrollHeight')
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => px })
    try {
      run()
    } finally {
      if (original) Object.defineProperty(proto, 'scrollHeight', original)
      else Reflect.deleteProperty(proto, 'scrollHeight')
    }
  }

  it('상한을 넘지 않으면 내용 높이만큼 늘어난다', () => {
    withScrollHeight(120, () => {
      const { textarea } = setup()
      type(textarea, '여러\n줄\n입력')
      expect(textarea.style.height).toBe('120px')
    })
  })

  it('상한(200px)을 넘으면 거기서 멈추고 스크롤한다', () => {
    withScrollHeight(9999, () => {
      const { textarea } = setup()
      type(textarea, '아주\n긴\n입력')
      expect(textarea.style.height).toBe('200px')
      expect(textarea.style.overflowY).toBe('auto')
    })
  })

  it('내용이 줄면 높이도 다시 줄어든다', () => {
    const { textarea } = setup()
    withScrollHeight(150, () => type(textarea, '여러\n줄\n입력'))
    expect(textarea.style.height).toBe('150px')

    withScrollHeight(30, () => type(textarea, '한 줄'))
    expect(textarea.style.height).toBe('30px')
  })
})
