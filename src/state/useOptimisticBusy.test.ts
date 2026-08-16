// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { HANDOFF_MS, useOptimisticBusy } from './useOptimisticBusy'

// **낙관 상태가 스스로 풀리는가.**
//
// 이 훅은 `turn_started` 를 기다리지 않고 「응답 중」을 먼저 켠다. 켜는 쪽은 사용자가 곧바로
// 보므로 깨지면 금방 드러나지만, **푸는 쪽은 그렇지 않다** — 전송 자체가 실패해 턴이 영영
// 안 열리면 중지 버튼이 굳고 사용자는 다음 질문을 못 보낸다. 증상은 "앱이 굳었다" 인데
// 원인은 화면 어디에도 안 적힌다.
//
// 그래서 여기서 겨누는 것은 **푸는 두 길**이다: 인계(진짜 스트리밍이 시작됨)와 상한(안 옴).

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const render = (streaming = false) =>
  renderHook(({ s }) => useOptimisticBusy(s), { initialProps: { s: streaming } })

describe('useOptimisticBusy', () => {
  // 이게 이 훅의 이유다 — 왕복을 기다리면 중지 버튼이 그만큼 늦게 바뀐다
  // (사용자 지적 2026-08-15: "llm model 에게 요청갔을 때 변경되는 느낌").
  it('보내는 순간 켜진다 — 런타임 응답을 안 기다린다', () => {
    const { result } = render()
    expect(result.current.busy).toBe(false)

    act(() => result.current.markSent())

    expect(result.current.busy).toBe(true)
  })

  // **인계.** 진짜 스트리밍이 시작되면 낙관 상태는 물러나야 한다. 안 물러나면 턴이 끝난
  // 뒤에도 `sending` 이 남아 중지 버튼이 그대로 뜬다 — 아래 마지막 줄이 그걸 잡는다.
  it('진짜 스트리밍이 시작되면 물러난다 — 턴이 끝나면 함께 꺼진다', () => {
    const { result, rerender } = render()
    act(() => result.current.markSent())

    rerender({ s: true })
    expect(result.current.busy).toBe(true)

    rerender({ s: false })
    expect(result.current.busy).toBe(false)
  })

  // ⭐ **턴이 영영 안 열리는 경우의 유일한 탈출구.** 전송이 실패하면 `turn_started` 가
  // 아예 안 오고, 이 상한이 없으면 중지 버튼이 굳어 다음 질문을 보낼 수 없다.
  it('턴이 영영 안 열리면 상한에서 스스로 풀린다', async () => {
    const { result } = render()
    act(() => result.current.markSent())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HANDOFF_MS)
    })

    expect(result.current.busy).toBe(false)
  })

  // 기준선 — 위 시험만 있으면 **0ms 에 푸는 구현**도 초록이다. 그러면 낙관 상태가
  // 아무 값도 못 하고, 이 훅이 있는 이유가 사라진다.
  it('상한 전에는 안 풀린다', async () => {
    const { result } = render()
    act(() => result.current.markSent())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HANDOFF_MS - 1)
    })

    expect(result.current.busy).toBe(true)
  })

  // 스트리밍이 도는 동안은 상한이 붙지 않는다 — 붙으면 10초짜리 긴 턴에서 중지 버튼이
  // 도중에 사라진다. (인계로 `sending` 이 이미 false 라 타이머가 안 걸리는 것이 근거다.)
  it('스트리밍이 도는 동안에는 상한이 끄지 않는다', async () => {
    const { result, rerender } = render()
    act(() => result.current.markSent())
    rerender({ s: true })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HANDOFF_MS * 2)
    })

    expect(result.current.busy).toBe(true)
  })
})
