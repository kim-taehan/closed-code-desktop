// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionAskText } from './ExtensionAskText'
import type { ExtensionAskTextPayload } from '../../shared/ipc/channels'

// 확장이 사람에게 묻는 창.
//
// 상자는 `getByRole('textbox')` 로 짚는다 — 창과 상자가 **같은 이름**을 갖기 때문이다
// (제목이 둘의 label 이다). 이름으로 찾으면 둘이 걸린다. **답하지 않으면 확장의 await 가 걸려 있다** —
// 여기서 잠그는 것은 「나가는 길이 늘 있는가」와 「취소가 빈 글로 눙쳐지지 않는가」다.

const REQUEST: ExtensionAskTextPayload = {
  requestId: 'askText:1',
  extension: '테스트 시나리오',
  title: '본보기 시나리오',
  hint: '이 결을 따라 씁니다',
  value: '이름: 관리자 목록',
  multiline: true,
}

afterEach(cleanup)

describe('물음창', () => {
  it('제목·도움말과 함께 **어느 확장이 묻는지** 보인다', () => {
    render(<ExtensionAskText request={REQUEST} onRespond={() => {}} />)

    expect(screen.getByText('본보기 시나리오')).toBeTruthy()
    expect(screen.getByText('이 결을 따라 씁니다')).toBeTruthy()
    // 익명으로 뜨는 입력창은 사용자가 무엇에 답하는지 모른 채 값을 넣게 한다
    expect(screen.getByText('테스트 시나리오')).toBeTruthy()
  })

  // 고쳐 쓰는 것이 기본 사용이다 — 빈 상자로만 물으면 매번 처음부터 써야 한다
  it('처음 값이 채워진 채로 뜬다', () => {
    render(<ExtensionAskText request={REQUEST} onRespond={() => {}} />)

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('이름: 관리자 목록')
  })

  it('고쳐서 저장하면 고친 글이 나간다', () => {
    const onRespond = vi.fn()
    render(<ExtensionAskText request={REQUEST} onRespond={onRespond} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '고친 글' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(onRespond).toHaveBeenCalledWith('고친 글')
  })
})

describe('나가는 길', () => {
  // 취소를 빈 문자열로 보내면 확장이 저장된 것을 날린다
  it('취소는 null 이다 — 빈 글이 아니다', () => {
    const onRespond = vi.fn()
    render(<ExtensionAskText request={REQUEST} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: '취소' }))

    expect(onRespond).toHaveBeenCalledWith(null)
  })

  it('Esc 로도 나간다 — 답을 안 하면 확장이 걸려 있다', () => {
    const onRespond = vi.fn()
    render(<ExtensionAskText request={REQUEST} onRespond={onRespond} />)

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(onRespond).toHaveBeenCalledWith(null)
  })
})

describe('Enter 의 뜻', () => {
  // 본보기는 여러 줄이다. Enter 로 보내 버리면 두 번째 줄을 쓸 수가 없다
  it('여러 줄 상자에서 그냥 Enter 는 줄바꿈이다', () => {
    const onRespond = vi.fn()
    render(<ExtensionAskText request={REQUEST} onRespond={onRespond} />)

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    expect(onRespond).not.toHaveBeenCalled()
  })

  it('여러 줄 상자에서는 ⌘/Ctrl+Enter 로 보낸다', () => {
    const onRespond = vi.fn()
    render(<ExtensionAskText request={REQUEST} onRespond={onRespond} />)

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true })

    expect(onRespond).toHaveBeenCalledWith('이름: 관리자 목록')
  })

  it('한 줄 상자에서는 그냥 Enter 로 보낸다', () => {
    const onRespond = vi.fn()
    render(<ExtensionAskText request={{ ...REQUEST, multiline: false }} onRespond={onRespond} />)

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    expect(onRespond).toHaveBeenCalledWith('이름: 관리자 목록')
  })
})
