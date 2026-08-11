// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MessageKind, type ChatMessage } from '../../shared/ipc/messageTypes'
import { AssistantMessage } from './AssistantMessage'

// 설계 §6.7 — 마크다운 파이프라인과 semanticType 클래스.

afterEach(cleanup)

function message(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm1', author: 'assistant', kind: MessageKind.TEXT, content, ...extra }
}

describe('마크다운 렌더', () => {
  it('제목과 강조를 해석한다', () => {
    const { container } = render(<AssistantMessage message={message('# 제목\n\n**굵게**')} />)

    expect(container.querySelector('h1')?.textContent).toBe('제목')
    expect(container.querySelector('strong')?.textContent).toBe('굵게')
  })

  it('gfm 표를 해석하고 가로 스크롤로 감싼다', () => {
    const markdown = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    const { container } = render(<AssistantMessage message={message(markdown)} />)

    const table = container.querySelector('table')
    expect(table).toBeTruthy()
    // 넓은 표가 화면을 밀지 않도록 스크롤 컨테이너에 넣는다
    expect((table!.parentElement as HTMLElement).style.overflowX).toBe('auto')
  })

  it('breaks 로 한 줄 개행이 <br> 이 된다', () => {
    const { container } = render(<AssistantMessage message={message('첫 줄\n둘째 줄')} />)
    expect(container.querySelector('br')).toBeTruthy()
  })

  it('코드 블록을 렌더한다', () => {
    const { container } = render(<AssistantMessage message={message('```ts\nconst a = 1\n```')} />)
    expect(container.querySelector('code')).toBeTruthy()
  })
})

describe('semanticType 클래스', () => {
  const types = ['plan', 'tool_summary', 'reflection', 'error', 'reply'] as const

  for (const semanticType of types) {
    it(`${semanticType} 은 수식 클래스가 붙는다`, () => {
      const { container } = render(<AssistantMessage message={message('내용', { semanticType })} />)
      expect(container.querySelector(`.cc-assistant-message--${semanticType}`)).toBeTruthy()
    })
  }

  it('semanticType 이 없으면 기본 클래스만 붙는다', () => {
    const { container } = render(<AssistantMessage message={message('내용')} />)
    const element = container.querySelector('.cc-assistant-message')!

    expect(element.className).toBe('cc-assistant-message')
  })
})

describe('rail 과 interrupted 라벨', () => {
  it('railEnd 면 cc-rail-end 가 붙는다', () => {
    const { container } = render(<AssistantMessage message={message('내용')} railEnd />)
    expect(container.querySelector('.cc-rail-end')).toBeTruthy()
  })

  it('중단된 메시지에는 라벨이 붙는다', () => {
    render(<AssistantMessage message={message('내용', { interrupted: true })} />)
    expect(screen.getByText('interrupted')).toBeTruthy()
  })

  it('턴 안에서는 인라인 라벨을 억제한다 — 턴 뒤에 하나만 붙는다', () => {
    render(<AssistantMessage message={message('내용', { interrupted: true })} hideInterruptedLabel />)
    expect(screen.queryByText('interrupted')).toBeNull()
  })
})

describe('스트리밍 중에도 내용은 그대로', () => {
  it('스트리밍 여부와 무관하게 내용은 그대로 나온다', () => {
    const { container } = render(<AssistantMessage message={message('**굵게**')} isStreamingTarget />)
    expect(container.querySelector('strong')?.textContent).toBe('굵게')
  })
})
