// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useCancelRequest } from './TurnControls'
import { Composer } from './Composer'

// 중지 버튼(응답 중의 전송 버튼). 사용자 증상은 **"눌러도 가끔 무시된다"** 였고, 원인의
// 절반은 화면이었다 — opencode 의 `interrupt` 는 204 만 주고 실제 종료는 SSE 로 뒤늦게
// 오는데, 그동안 버튼이 그대로라 눌린 티가 안 났다. 그래서 또 누르고, 그만큼 interrupt 가
// 더 나갔다. 알약(TurnControls 컴포넌트) 시절의 방어를 새 자리(↑→■)에서 그대로 잠근다.
//
// ChatComposer 의 배선을 그대로 흉내 낸 호스트로 검증한다 — 훅과 버튼을 따로 재면
// 「층은 각각 잠겼는데 층 사이가 안 이어진」 초록이 된다 (contract-crosscheck 원칙 8).

afterEach(cleanup)

function Host({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  const cancel = useCancelRequest(busy)
  return (
    <Composer
      onSubmit={() => {}}
      {...(busy
        ? { stop: { pending: cancel.pending, onPress: () => cancel.request(onCancel) } }
        : {})}
    />
  )
}

const stopButton = () => screen.getByRole('button', { name: '응답 중단' }) as HTMLButtonElement

describe('중지 버튼 (↑ → ■)', () => {
  afterEach(() => vi.useRealTimers())

  it('응답 중에는 전송 버튼 자리가 중지 버튼이 된다 — 자리는 하나뿐이다', () => {
    render(<Host busy onCancel={() => {}} />)
    expect(stopButton()).toBeTruthy()
    expect(screen.queryByRole('button', { name: '전송' })).toBeNull()
  })

  it('응답이 없으면 전송 버튼이다', () => {
    render(<Host busy={false} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: '전송' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '응답 중단' })).toBeNull()
  })

  it('누르면 즉시 잠긴다 — 연타해도 interrupt 는 한 번만 나간다', () => {
    vi.useFakeTimers()
    const onCancel = vi.fn()
    render(<Host busy onCancel={onCancel} />)

    fireEvent.click(stopButton())
    expect(stopButton().disabled).toBe(true)

    fireEvent.click(stopButton())
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('응답이 없으면 상한에서 풀린다 — 영원한 잠김 금지', () => {
    vi.useFakeTimers()
    render(<Host busy onCancel={() => {}} />)
    fireEvent.click(stopButton())

    // main 의 TurnGate 강제 종단(5초)보다 뒤여야 한다 — 곧 닫힐 턴을 두고 먼저 풀지 않게
    act(() => void vi.advanceTimersByTime(5_000))
    expect(stopButton().disabled).toBe(true)

    act(() => void vi.advanceTimersByTime(3_000))
    expect(stopButton().disabled).toBe(false)
  })

  it('턴이 끝나면 잠김이 남지 않는다 — 다음 턴의 중지 버튼은 눌린다', () => {
    vi.useFakeTimers()
    const onCancel = vi.fn()
    const { rerender } = render(<Host busy onCancel={onCancel} />)
    fireEvent.click(stopButton())

    // 턴 종료 → busy=false (버튼은 ↑ 로 돌아간다)
    rerender(<Host busy={false} onCancel={onCancel} />)
    // 다음 턴
    rerender(<Host busy onCancel={onCancel} />)

    expect(stopButton().disabled).toBe(false)
    fireEvent.click(stopButton())
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
