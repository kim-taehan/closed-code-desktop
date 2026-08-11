// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary, ErrorPage, installBlankScreenGuard } from './ErrorPage'

// 렌더러 흰 화면 방어선. 렌더 중 throw 가 트리 전체를 지우는 대신 에러 페이지가 나오고,
// "초기 상태로 돌아가기"가 재로드로 복귀시키는지 확인한다 (전례: a17ba09 언어 변경 흰 화면).

beforeEach(() => {
  // React 가 경계에 잡힌 에러도 console.error 로 남긴다 — 테스트 출력만 조용히 한다
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** 렌더 중 항상 throw 하는 자식 */
function Bomb(): never {
  throw new Error('렌더 폭발')
}

describe('ErrorBoundary', () => {
  it('자식이 렌더 중 throw 하면 흰 화면 대신 에러 페이지를 그린다', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText('화면을 그리지 못했습니다')).toBeDefined()
    expect(screen.getByText('렌더 폭발')).toBeDefined()
  })

  it('에러가 없으면 자식을 그대로 그린다', () => {
    render(
      <ErrorBoundary>
        <span>정상 화면</span>
      </ErrorBoundary>,
    )
    expect(screen.getByText('정상 화면')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('ErrorPage', () => {
  it('스택은 접힌 상세로 보인다', () => {
    const error = new Error('원인')
    const { container } = render(<ErrorPage error={error} />)

    expect(screen.getByText('자세한 내용')).toBeDefined()
    // 여러 줄 스택은 getByText 의 공백 정규화와 안 맞는다 — textContent 로 본다
    expect(container.querySelector('pre')?.textContent).toContain('원인')
  })

  it('초기 상태로 돌아가기 버튼이 재시작(onReset)을 부른다', () => {
    // jsdom 은 location.reload 재정의를 막는다 — 기본값이 reload 인 onReset 을 주입해 확인
    const onReset = vi.fn()
    render(<ErrorPage error={new Error('원인')} onReset={onReset} />)

    fireEvent.click(screen.getByText('초기 상태로 돌아가기'))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('Error 가 아닌 값도 메시지로 보인다', () => {
    render(<ErrorPage error="문자열 오류" />)
    expect(screen.getByText('문자열 오류')).toBeDefined()
  })
})

describe('installBlankScreenGuard — React 밖 에러', () => {
  it('루트가 비어 있을 때(부트 실패) 에러 이벤트가 오면 에러 페이지를 그린다', () => {
    const container = document.createElement('div')
    const renderPage = vi.fn()
    installBlankScreenGuard(container, renderPage)

    const error = new Error('부트 실패')
    window.dispatchEvent(new ErrorEvent('error', { error }))
    expect(renderPage).toHaveBeenCalledWith(error)
  })

  it('루트가 이미 그려져 있으면 덮지 않는다 — 사소한 비동기 에러는 콘솔로 충분하다', () => {
    const container = document.createElement('div')
    container.appendChild(document.createElement('main'))
    const renderPage = vi.fn()
    installBlankScreenGuard(container, renderPage)

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('비동기 에러') }))
    expect(renderPage).not.toHaveBeenCalled()
  })
})
