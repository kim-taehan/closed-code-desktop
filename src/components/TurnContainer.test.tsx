// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TurnContainer } from './TurnContainer'

// 설계 §6.1, §6.2 의 턴 헤더·배치 계약.
// 문자열과 수치가 vscode 와 정확히 같아야 한다.

afterEach(cleanup)

/** React 19 는 상태 갱신을 배치하므로 타이머 진행을 act 로 감싼다 */
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

function renderTurn(props: Partial<Parameters<typeof TurnContainer>[0]> = {}) {
  return render(
    <TurnContainer
      turnId="t1"
      body={[<div key="a">단계 A</div>]}
      isStreaming={false}
      terminal={true}
      {...props}
    />,
  )
}

describe('헤더 기본 형태', () => {
  it('텍스트는 문자열 그대로 Closed Code 다', () => {
    renderTurn()
    expect(screen.getByText('Closed Code')).toBeTruthy()
  })

  it('스텝은 복수형 없이 "{n} step" 이다', () => {
    renderTurn({ body: [<div key="a" />, <div key="b" />, <div key="c" />] })
    expect(screen.getByText('3 step')).toBeTruthy()
  })

  it('스텝 수는 body 노드 수다 — 도구 개수가 아니다', () => {
    // 연속 도구 묶음은 노드 1개이므로 1 step 이 된다
    renderTurn({ body: [<div key="tools">도구 3개 묶음</div>] })
    expect(screen.getByText('1 step')).toBeTruthy()
  })
})

describe('스텝이 0 인 턴', () => {
  it('토글도 스텝 표기도 없고 body 요소 자체를 만들지 않는다', () => {
    const { container } = renderTurn({ body: [] })

    expect(container.querySelector('.cc-turn-toggle')).toBeNull()
    expect(screen.queryByText(/step/)).toBeNull()
    expect(container.querySelector('.cc-turn-body')).toBeNull()
    expect(container.querySelector('.cc-turn-header--no-toggle')).toBeTruthy()
  })

  it('그래도 헤더 텍스트는 나온다', () => {
    renderTurn({ body: [] })
    expect(screen.getByText('Closed Code')).toBeTruthy()
  })
})

describe('경과시간', () => {
  it('확정된 durationMs 를 포맷해서 보여준다', () => {
    renderTurn({ durationMs: 65_000 })
    expect(screen.getByText('1m 5s')).toBeTruthy()
  })

  it('1초 미만은 <1s 다', () => {
    renderTurn({ durationMs: 300 })
    expect(screen.getByText('<1s')).toBeTruthy()
  })

  it('durationMs 도 startedAt 도 없으면 표시하지 않는다', () => {
    const { container } = renderTurn()
    const metas = container.querySelectorAll('.cc-turn-header-meta')
    // 스텝 표기 하나뿐이어야 한다
    expect(metas).toHaveLength(1)
    expect(metas[0]!.textContent).toBe('1 step')
  })

  it('스트리밍 중이면 시작 시각부터 센다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    renderTurn({ isStreaming: true, terminal: false, startedAt: 3_000 })

    expect(screen.getByText('7s')).toBeTruthy()
    vi.useRealTimers()
  })

  it('스트리밍 중에는 1초마다 갱신된다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    renderTurn({ isStreaming: true, terminal: false, startedAt: 3_000 })
    expect(screen.getByText('7s')).toBeTruthy()

    // advanceTimersByTime 이 가짜 시계도 함께 민다 — 3초 뒤엔 10s 가 돼야 한다
    advance(3000)
    expect(screen.getByText('10s')).toBeTruthy()

    vi.useRealTimers()
  })
})

describe('자동 접힘 (350ms)', () => {
  it('스트리밍 중에는 펼쳐진 채로 있다', () => {
    vi.useFakeTimers()
    const { container } = renderTurn({ isStreaming: true, terminal: false })

    advance(2000)
    expect(container.querySelector('.cc-turn-body--expanded')).toBeTruthy()
    vi.useRealTimers()
  })

  it('턴이 끝나면 350ms 뒤에 접힌다', () => {
    vi.useFakeTimers()
    const { container } = renderTurn({ isStreaming: false, terminal: true })

    expect(container.querySelector('.cc-turn-body--expanded')).toBeTruthy()
    advance(349)
    expect(container.querySelector('.cc-turn-body--expanded')).toBeTruthy()

    advance(1)
    expect(container.querySelector('.cc-turn-body--expanded')).toBeNull()
    vi.useRealTimers()
  })

  it('접혀도 body 요소는 남고 aria-hidden 이 붙는다', () => {
    vi.useFakeTimers()
    const { container } = renderTurn({ isStreaming: false, terminal: true })
    advance(350)

    const body = container.querySelector('.cc-turn-body')
    expect(body).toBeTruthy()
    expect(body!.getAttribute('aria-hidden')).toBe('true')
    vi.useRealTimers()
  })
})

describe('클릭 가능 조건', () => {
  it('스텝이 있고 스트리밍이 아니고 종료됐을 때만 누를 수 있다', () => {
    const { container } = renderTurn({ isStreaming: false, terminal: true })
    const header = container.querySelector('.cc-turn-header')!

    expect(header.classList.contains('cc-turn-header--clickable')).toBe(true)
    expect(header.getAttribute('role')).toBe('button')
  })

  it('스트리밍 중에는 누를 수 없다', () => {
    const { container } = renderTurn({ isStreaming: true, terminal: false })
    const header = container.querySelector('.cc-turn-header')!

    expect(header.classList.contains('cc-turn-header--clickable')).toBe(false)
    expect(header.getAttribute('role')).toBeNull()
  })

  it('스텝이 0 이면 누를 수 없다', () => {
    const { container } = renderTurn({ body: [] })
    expect(container.querySelector('.cc-turn-header--clickable')).toBeNull()
  })

  it('클릭하면 접힌다', () => {
    const { container } = renderTurn()
    fireEvent.click(container.querySelector('.cc-turn-header')!)

    expect(container.querySelector('.cc-turn-body--expanded')).toBeNull()
  })

  it('Enter 와 Space 로 토글된다', () => {
    const { container } = renderTurn()
    const header = container.querySelector('.cc-turn-header')!

    fireEvent.keyDown(header, { key: 'Enter' })
    expect(container.querySelector('.cc-turn-body--expanded')).toBeNull()

    fireEvent.keyDown(header, { key: ' ' })
    expect(container.querySelector('.cc-turn-body--expanded')).toBeTruthy()
  })

  it('다른 키에는 반응하지 않는다', () => {
    const { container } = renderTurn()
    fireEvent.keyDown(container.querySelector('.cc-turn-header')!, { key: 'a' })

    expect(container.querySelector('.cc-turn-body--expanded')).toBeTruthy()
  })

  it('사용자가 직접 편 뒤에는 자동으로 접히지 않는다', () => {
    vi.useFakeTimers()
    const { container } = renderTurn()

    // 자동 접힘
    advance(350)
    expect(container.querySelector('.cc-turn-body--expanded')).toBeNull()

    // 사용자가 다시 폄
    fireEvent.click(container.querySelector('.cc-turn-header')!)
    expect(container.querySelector('.cc-turn-body--expanded')).toBeTruthy()

    // 다시 접히면 안 된다
    advance(2000)
    expect(container.querySelector('.cc-turn-body--expanded')).toBeTruthy()
    vi.useRealTimers()
  })

  it('토글 버튼의 title 이 상태에 따라 바뀐다', () => {
    const { container } = renderTurn({ isStreaming: true, terminal: false })
    expect(container.querySelector('.cc-turn-toggle')!.getAttribute('title')).toBe('Collapse turn steps')
  })
})

describe('배치 순서 (설계 §6.1)', () => {
  it('reply 는 body 바깥, body 뒤에 온다', () => {
    const { container } = renderTurn({
      body: [<div key="a" className="step-node" />],
      reply: <div className="reply-node">답변</div>,
    })

    const body = container.querySelector('.cc-turn-body')!
    expect(body.querySelector('.reply-node')).toBeNull()

    const nodes = [...container.children]
    expect(nodes.indexOf(body)).toBeLessThan(
      nodes.findIndex((node) => node.classList.contains('reply-node')),
    )
  })

  it('중단된 턴에는 interrupted 라벨이 붙는다', () => {
    renderTurn({ interrupted: true })
    expect(screen.getByText('interrupted')).toBeTruthy()
  })

  it('중단된 턴은 종료된 턴처럼 접히고 클릭 가능해진다', () => {
    vi.useFakeTimers()
    const { container } = renderTurn({ isStreaming: true, terminal: false, interrupted: true })

    expect(container.querySelector('.cc-turn-header--clickable')).toBeTruthy()
    advance(350)
    expect(container.querySelector('.cc-turn-body--expanded')).toBeNull()
    vi.useRealTimers()
  })

  it('리뷰 자리와 토큰 자리는 맨 뒤에 순서대로 온다', () => {
    const { container } = renderTurn({
      reply: <div className="reply-node" />,
      reviewSlot: <div className="review-node" />,
      tokenSlot: <div className="token-node" />,
    })

    const nodes = [...container.children]
    const indexOf = (selector: string) => nodes.findIndex((node) => node.matches(selector))

    expect(indexOf('.reply-node')).toBeLessThan(indexOf('.review-node'))
    expect(indexOf('.review-node')).toBeLessThan(indexOf('.token-node'))
  })
})
