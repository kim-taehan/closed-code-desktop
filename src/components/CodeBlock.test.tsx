// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageKind, type ChatMessage } from '../../shared/ipc/messageTypes'
import { AssistantMessage } from './AssistantMessage'
import { extractText } from './CodeBlock'

// 코드 블록 wrapper (vscode 미러) — 복사 원문 복원(DC-681)·접힘 임계·스트리밍 축소판.
// AssistantMessage 를 통해 실제 마크다운 파이프라인(rehype-highlight 포함)을 태운다.

function message(content: string): ChatMessage {
  return { id: 'm1', author: 'assistant', kind: MessageKind.TEXT, content }
}

const writeText = vi.fn().mockResolvedValue(undefined)
Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('extractText — 재귀 평탄화 (DC-681)', () => {
  it('하이라이트 토큰 span 트리에서 원문을 복원한다 — 얕은 매핑이면 식별자가 빈다', () => {
    // rehype-highlight 가 넘기는 형태: string 과 중첩 ReactElement 가 섞인 배열
    const tokens = [
      <span key="k" className="hljs-keyword">const</span>,
      ' answer = ',
      <span key="n" className="hljs-number">42</span>,
      '\n',
      <span key="t" className="hljs-title">
        run<span className="hljs-params">(deep)</span>
      </span>,
    ]
    expect(extractText(tokens)).toBe('const answer = 42\nrun(deep)')
  })

  it('null·boolean 은 빈 문자열, number 는 문자열이 된다', () => {
    expect(extractText([null, true, 7, 'x'])).toBe('7x')
  })
})

describe('복사', () => {
  it('하이라이트된 블록에서도 원문 그대로 클립보드에 실린다 + 2초 복사됨 표시', async () => {
    vi.useFakeTimers()
    try {
      render(<AssistantMessage message={message('```ts\nconst answer = 42\nreturn answer\n```')} />)

      fireEvent.click(screen.getByText('복사'))
      // 클립보드 promise 가 microtask 로 풀린다
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      // rehype-highlight 토큰 트리를 거쳐도 원문이 그대로다 (트레일링 개행 포함)
      expect(writeText).toHaveBeenCalledWith('const answer = 42\nreturn answer\n')
      expect(screen.getByText('복사됨')).toBeTruthy()

      // 2초 뒤 원래 라벨로 돌아온다
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(screen.getByText('복사')).toBeTruthy()
      expect(screen.queryByText('복사됨')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('접힘 임계 (240px)', () => {
  it('임계를 넘으면 접힌 채 더 보기가 뜨고, 누르면 펼쳐진다', () => {
    // jsdom 은 레이아웃이 없어 scrollHeight 를 임계 초과로 흉내 낸다
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(500)
    try {
      const { container } = render(<AssistantMessage message={message('```ts\nlong\n```')} />)

      expect(container.querySelector('.code-block-collapsed')).toBeTruthy()
      fireEvent.click(screen.getByText('▼ 더 보기'))
      expect(container.querySelector('.code-block-collapsed')).toBeNull()
      expect(screen.getByText('▲ 접기')).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })

  it('임계 이하면 더 보기 버튼이 없다', () => {
    const { container } = render(<AssistantMessage message={message('```ts\nshort\n```')} />)
    expect(container.querySelector('.code-block-expand-btn')).toBeNull()
    expect(container.querySelector('.code-block-collapsed')).toBeNull()
  })
})

describe('스트리밍 분기', () => {
  it('스트리밍 중엔 헤더·복사·접기 없는 축소판 <pre> 다', () => {
    const { container } = render(
      <AssistantMessage message={message('```ts\nconst a = 1\n```')} isStreamingTarget />,
    )
    expect(container.querySelector('.streaming-code-block')).toBeTruthy()
    expect(container.querySelector('.codeBlock')).toBeNull()
    expect(screen.queryByText('복사')).toBeNull()
    expect(container.querySelector('.code-block-expand-btn')).toBeNull()
  })

  it('정착 후엔 언어 라벨 헤더가 붙은 풀 wrapper 다', () => {
    const { container } = render(<AssistantMessage message={message('```ts\nconst a = 1\n```')} />)
    expect(container.querySelector('.codeBlock')).toBeTruthy()
    expect(container.querySelector('.code-block-lang')?.textContent).toBe('ts')
    expect(screen.getByText('복사')).toBeTruthy()
  })
})

describe('인라인 코드', () => {
  it('한 줄 인라인 코드에는 wrapper 를 씌우지 않는다', () => {
    const { container } = render(<AssistantMessage message={message('앞 `inline` 뒤')} />)
    expect(container.querySelector('code')?.textContent).toBe('inline')
    expect(container.querySelector('.codeBlock')).toBeNull()
  })
})
