// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TurnControls } from './TurnControls'

// 중단 버튼. 사용자 증상은 **"눌러도 가끔 무시된다"** 였고, 원인의 절반은 화면이었다 —
// opencode 의 `interrupt` 는 204 만 주고 실제 종료는 SSE 로 뒤늦게 오는데, 그동안 버튼이
// 「중단」 그대로라 눌린 티가 안 났다. 그래서 또 누르고, 그만큼 interrupt 가 더 나갔다.

afterEach(cleanup)

/** 버튼은 busy 1초 뒤에야 뜬다 (깜빡임 방지) — 그 지연을 건너뛴다 */
function renderBusy(onCancel = () => {}) {
  vi.useFakeTimers()
  const view = render(<TurnControls busy onCancel={onCancel} />)
  act(() => void vi.advanceTimersByTime(1_000))
  return view
}

describe('중단 버튼', () => {
  afterEach(() => vi.useRealTimers())

  it('전송 직후에는 뜨지 않는다 — 짧은 응답에서 깜빡인다', () => {
    vi.useFakeTimers()
    render(<TurnControls busy onCancel={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('누르면 즉시 「중단중…」 이 되고 다시 눌리지 않는다', () => {
    const onCancel = vi.fn()
    renderBusy(onCancel)

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe('중단중…')
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)

    // 연타해도 한 번만 나간다 (같은 방어가 main 에도 있다 — chatSession.cancel)
    fireEvent.click(screen.getByRole('button'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('응답이 없으면 상한에서 풀고 그 사실을 말한다 — 영원한 「중단중…」 금지', () => {
    renderBusy()
    fireEvent.click(screen.getByRole('button'))

    // main 의 TurnGate 강제 종단(5초)보다 뒤여야 한다 — 곧 닫힐 턴을 두고 먼저 말하지 않게
    act(() => void vi.advanceTimersByTime(5_000))
    expect(screen.getByRole('button').textContent).toBe('중단중…')

    act(() => void vi.advanceTimersByTime(3_000))
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText(/응답이 없습니다/)).toBeTruthy()
  })

  it('턴이 끝나면 상태가 남지 않는다 — 언마운트가 아니라 감추기라 직접 푼다', () => {
    const onCancel = vi.fn()
    const { rerender } = renderBusy(onCancel)
    fireEvent.click(screen.getByRole('button'))

    // 턴 종료 → busy=false. ChatComposer 는 이 컴포넌트를 계속 렌더한다.
    rerender(<TurnControls busy={false} onCancel={onCancel} />)
    // 다음 턴
    rerender(<TurnControls busy onCancel={onCancel} />)
    act(() => void vi.advanceTimersByTime(1_000))

    expect(screen.getByRole('button').textContent).toBe('중단')
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false)
  })
})
