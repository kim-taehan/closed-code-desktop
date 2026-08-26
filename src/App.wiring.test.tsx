// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from './App'
import { emit, installDavisMock, type DavisMock } from './appWiringHarness'
import { HIDE_DELAY_MS } from './components/LoadingIndicator'
import { HANDOFF_MS } from './state/useOptimisticBusy'

// **조립**을 재는 스모크. 부품이 아니라 App 이 부품을 잇는 자리를 겨눈다.
//
// 커버리지에서 App.tsx·ChatComposer.tsx·MainView.tsx 는 문장 0% 였다 — 아래 부품에는
// 전부 시험이 있는데 **이어붙인 자리만 무검증**이었고, 2026-08-26 의 결함 둘이 정확히
// 거기서 났다:
//
//   1. 전송해도 진행 표시가 안 떴다 — 낙관 상태를 입력창만 알고 대화 화면은 몰랐다.
//   2. 중지를 눌러도 무시당한 것처럼 보였다 — 낙관 구간에는 닫힐 턴이 없어
//      `turn_ended` 가 영영 안 오고, 푸는 사람이 아무도 없었다.
//
// 둘 다 **한 `useOptimisticBusy` 인스턴스를 App 이 양쪽에 내려보내는가**로 갈린다.
// 그래서 훅을 흉내내지 않는다 — 진짜 App 을 띄우고 `window.davis` 만 세운다.
// 훅과 버튼을 따로 재면 「층은 각각 잠겼는데 층 사이가 안 이어진」 초록이 된다
// (contract-crosscheck 원칙 8, TurnControls.test.tsx 가 같은 이유로 호스트를 쓴다).

let davis: DavisMock

const composer = () => document.querySelector('.composer-bar textarea') as HTMLTextAreaElement
const stopButton = () => screen.queryByRole('button', { name: '응답 중단' })
const sendButton = () => screen.queryByRole('button', { name: '전송' })
/** 진행 표시(LoadingIndicator). 판정 기준은 ChatPane.test.tsx 와 같은 자리를 쓴다. */
const spinner = () => document.querySelector('.chat-gutter .message.assistant')

/** 열린 프로젝트 하나 + 핸드셰이크 ready 까지 밀어 넣는다 — 그래야 입력창이 살아난다. */
async function mountReadyApp(): Promise<void> {
  render(<App />)
  // listProjects 의 프라미스가 풀리는 것을 기다린다 (useProjects 의 최초 적재).
  // 마이크로태스크라 가짜 타이머와 무관하게 풀린다.
  await act(async () => {
    await Promise.resolve()
  })
  act(() => {
    emit(davis, 'onSessionState', { handshake: { stage: 'ready' } }, 'p1')
  })
}

/** 입력창에 치고 Enter — 사용자가 실제로 밟는 그 경로다 (슬래시·`!셸` 갈래는 위에서 갈린다) */
function sendPrompt(text: string): void {
  fireEvent.change(composer(), { target: { value: text } })
  fireEvent.keyDown(composer(), { key: 'Enter' })
}

/**
 * 진행 표시의 **해제 지연**을 넘긴다.
 *
 * `LoadingIndicator` 는 켤 때는 즉시, 끌 때는 320ms 뒤에 끈다 — 도구 실행 사이의 짧은
 * 공백마다 깜빡이지 않게 하려는 것이다. 그래서 "중지를 눌렀다" 와 "표시가 사라졌다"
 * 사이에는 정상 동작으로도 틈이 있고, 그 틈을 안 넘기면 아래 단언이 헛돈다.
 */
function passHideDelay(): void {
  act(() => void vi.advanceTimersByTime(HIDE_DELAY_MS + 1))
}

beforeEach(() => {
  vi.useFakeTimers()
  davis = installDavisMock()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('App 조립 — 전송·진행 표시·중지', () => {
  // 기준선. 대역이 조용히 풀리면 App 은 런처 화면이나 「연결을 기다리는 중」 에 머무는데,
  // 그 상태에서는 아래 시험들이 **전송이 막혀서** 초록이 될 수 있다 — 아무것도 안 겨눈 채로.
  it('열린 프로젝트와 ready 핸드셰이크가 실제로 들어가 입력창이 살아난다', async () => {
    await mountReadyApp()
    expect(composer().disabled).toBe(false)
    expect(composer().placeholder).toBe('메시지를 입력하세요…')
    expect(sendButton()).toBeTruthy()
    // 아직 아무것도 안 보냈으니 진행 표시는 없다
    expect(spinner()).toBeNull()
  })

  it('전송하면 turn_started 전에도 진행 표시가 즉시 뜬다', async () => {
    await mountReadyApp()

    sendPrompt('안녕')

    // 보낸 것은 실제로 나갔다 — 진행 표시만 뜨고 전송이 안 된 초록을 막는다
    expect(davis.sendChat).toHaveBeenCalledTimes(1)
    // 런타임은 아직 아무 이벤트도 안 줬다. 그래도 화면은 「응답 중」 이어야 한다.
    expect(spinner()).toBeTruthy()
    expect(stopButton()).toBeTruthy()
    expect(sendButton()).toBeNull()
  })

  it('낙관 구간에서 중지를 누르면 그 자리에서 풀린다 — turn_ended 를 기다리지 않는다', async () => {
    await mountReadyApp()

    sendPrompt('안녕')
    expect(spinner()).toBeTruthy()

    fireEvent.click(stopButton()!)

    expect(davis.cancelChat).toHaveBeenCalledTimes(1)
    // 버튼은 **즉시** 돌아와야 한다 — 눌린 티가 안 나면 사용자는 또 누른다
    expect(sendButton()).toBeTruthy()
    expect(stopButton()).toBeNull()

    // 여기가 결함이 났던 자리다. `turn_ended` 가 올 턴이 없으므로 낙관 상태를
    // 중지 쪽에서 직접 풀지 않으면 상한(HANDOFF_MS)까지 표시가 그대로 남는다.
    passHideDelay()
    expect(spinner()).toBeNull()
  })

  it('진짜 턴이 열린 뒤의 중지는 turn_ended 까지 진행 표시를 유지한다', async () => {
    await mountReadyApp()

    sendPrompt('안녕')
    act(() => {
      emit(davis, 'onTurnEvent', { type: 'turn_started' }, 'p1')
    })

    fireEvent.click(stopButton()!)

    // 낙관 상태는 풀렸지만 isStreaming 이 busy 를 지킨다 — 중단은 SSE 로 뒤늦게 온다.
    // 여기서 표시가 사라지면 아직 도는 턴을 두고 "끝났다" 고 말하는 것이 된다.
    // 해제 지연을 넘겨서 본다 — 안 넘기면 "아직 안 사라졌을 뿐" 과 구별이 안 된다.
    expect(davis.cancelChat).toHaveBeenCalledTimes(1)
    passHideDelay()
    expect(spinner()).toBeTruthy()
    expect(stopButton()).toBeTruthy()

    act(() => {
      emit(davis, 'onTurnEvent', { type: 'turn_ended', failed: false }, 'p1')
    })
    passHideDelay()
    expect(spinner()).toBeNull()
    expect(sendButton()).toBeTruthy()
  })

  it('턴이 영영 안 열려도 상한에서 스스로 풀린다 — 굳은 중지 버튼 금지', async () => {
    await mountReadyApp()

    sendPrompt('안녕')
    expect(spinner()).toBeTruthy()

    // 전송은 나갔는데 런타임이 턴을 영영 안 여는 경우 (전송 자체가 실패했을 때).
    // 이 탈출구가 없으면 중지 버튼이 굳어 다음 질문을 아예 못 보낸다.
    act(() => void vi.advanceTimersByTime(HANDOFF_MS + 1))
    passHideDelay()

    expect(spinner()).toBeNull()
    expect(sendButton()).toBeTruthy()
    expect(composer().disabled).toBe(false)
  })
})
