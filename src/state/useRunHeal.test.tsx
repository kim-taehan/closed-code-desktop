// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRACE_MS, WATCH_MS, useRunHeal } from './useRunHeal'
import type { RunEntry } from '../../shared/run/runList'

// **시간이 지나야 드러나는 부류다** (설계 2026-08-16 §6 마지막 줄). Doctor 에서 이 시험이
// 없어 결함이 조용히 살았다 — 첫 창에서는 멀쩡히 돌았기 때문이다. 그래서 여기서는 가짜
// 타이머로 **분 단위**를 돌린다.
//
// 겨누는 것은 셋이다:
//   ① 예고가 조치보다 **먼저** 그려지는가 (그 틈이 「지금은 그만」의 시간이다)
//   ② 자동이 **한 바퀴**로 멈추는가 — 화면이 비워진 뒤에도
//   ③ 우리 것이 아닌 칸·프로젝트에 손대지 않는가

afterEach(cleanup)

type DataHandler = (payload: { name: string; chunk: string }, from: string) => void

let onData: DataHandler | null = null
const sendShellInput = vi.fn()
const onShellData = vi.fn((handler: DataHandler) => {
  onData = handler
  return () => {
    onData = null
  }
})

const DEV: RunEntry = { name: 'dev 서버', command: 'npm run dev' }
/** Node 가 실제로 내는 문장. 이 줄 하나가 처방의 방아쇠다 */
const FAIL = "Error: Cannot find module 'vite'\r\n"

beforeEach(() => {
  onData = null
  sendShellInput.mockReset()
  onShellData.mockClear()
  ;(window as unknown as { davis: unknown }).davis = { onShellData, sendShellInput }
})

function Probe({ id, entries }: { id: string; entries: readonly RunEntry[] }) {
  const heal = useRunHeal(id, entries)
  return (
    <>
      <span data-testid="head">{heal.notice?.headline ?? '-'}</span>
      <button type="button" onClick={heal.dismiss}>
        stop
      </button>
    </>
  )
}

const head = (): string => screen.getByTestId('head').textContent ?? ''

/** 그 칸이 한 덩어리를 뱉었다 */
async function emit(name: string, chunk: string, from = 'A'): Promise<void> {
  await act(async () => {
    onData?.({ name, chunk }, from)
  })
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** 실패를 뱉고 예고까지 (아직 조치는 안 나갔다) */
async function announce(): Promise<void> {
  render(<Probe id="A" entries={[DEV]} />)
  await emit(DEV.name, FAIL)
}

describe('예고가 조치보다 먼저다', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // ⭐ 무거운 조치가 **일어난 뒤에** 알리면 사용자는 통보만 받고 멈출 기회를 못 가진다
  // (Doctor 설계 §3). 그래서 예고가 먼저 그려지고, 그 뒤 `GRACE_MS` 가 물릴 시간이다.
  it('예고를 그린 시점에는 아직 아무것도 안 보냈다', async () => {
    await announce()
    expect(head()).toContain('npm install')
    expect(head()).toContain('다시 띄웁니다')
    // 틈이 **얼마나** 되는지도 화면에 적혀 있어야 한다. 이 줄이 없으면 `GRACE_MS` 를 0 으로
    // 줄여도 시험이 전부 초록이다(가짜 타이머는 0 도 안 흘려보낸다) — 물릴 시간이 사라진
    // 것을 아무도 못 잡는다. 실측으로 확인한 자리다.
    expect(head()).toContain(`${GRACE_MS / 1000}초 뒤`)
    expect(sendShellInput).not.toHaveBeenCalled()
  })

  it('틈이 지나면 설치와 재실행을 한 줄로 보낸다', async () => {
    await announce()
    await wait(GRACE_MS)
    expect(sendShellInput).toHaveBeenCalledWith({
      name: DEV.name,
      data: 'npm install && npm run dev\n',
    })
  })

  // 「지금은 그만」은 **물리는** 것이다 — 물린 뒤 다음 줄이 도착하자마자 또 예고하면
  // 그건 물린 것이 아니다
  it('「지금은 그만」이면 조치가 안 나가고, 다시 예고하지도 않는다', async () => {
    await announce()
    fireEvent.click(screen.getByText('stop'))
    await wait(GRACE_MS * 4)
    expect(sendShellInput).not.toHaveBeenCalled()
    expect(head()).toBe('-')

    await emit(DEV.name, FAIL)
    await wait(GRACE_MS * 4)
    expect(sendShellInput).not.toHaveBeenCalled()
    expect(head()).toBe('-')
  })
})

describe('자동은 한 바퀴만', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // ⭐⭐ **이 시험이 이 파일의 이유다.**
  //
  // 상한의 근거(`usedRef`)를 화면 값(`heal`)에 두면, 회전이 끝나며 화면을 비우는 순간
  // 상한도 함께 풀린다 — 그러면 같은 실패에 설치가 또 나가고 **그것이 설치 루프**다.
  // Doctor 에서 값을 치른 함정이 정확히 이 모양이었다(재측정이 자기가 서 있던 조건을 지웠다).
  //
  // **한 창만 보는 시험은 못 잡는다** — 첫 바퀴는 어느 구현에서든 멀쩡히 돈다.
  // 그래서 화면이 비워지는 자리(`WATCH_MS`)를 **넘겨서** 다시 뱉어 본다.
  it('화면이 비워진 뒤에 같은 실패가 또 나도 두 번째 설치는 없다', async () => {
    await announce()
    await wait(GRACE_MS)
    expect(sendShellInput).toHaveBeenCalledTimes(1)

    // 조용한 채로 감시 창을 넘긴다 — 말을 멈춘다 (성공을 잰 것이 아니다)
    await wait(WATCH_MS + 1_000)
    expect(head()).toBe('-')

    // 같은 실패가 다시 났다. 상한이 화면과 같은 그릇이었다면 여기서 2가 된다.
    await emit(DEV.name, FAIL)
    await wait(GRACE_MS * 2)
    expect(sendShellInput).toHaveBeenCalledTimes(1)
    expect(head()).toBe('-')
  })

  // 5분 동안 30초마다 같은 실패를 뱉어도 설치는 한 번뿐이다.
  //
  // **화면을 먼저 닫는다.** 안 닫으면 「한 번에 한 바퀴만」 이라는 **다른 겹**이 먼저 막아
  // 이 시험이 상한을 재지 않는다 — 통과했다고 겨누던 자리가 돈 것은 아니다.
  it('5분을 돌려도 설치는 한 번뿐이다', async () => {
    await announce()
    await wait(GRACE_MS)
    fireEvent.click(screen.getByText('stop'))
    for (let round = 0; round < 10; round += 1) {
      await emit(DEV.name, FAIL)
      await wait(30_000)
    }
    expect(sendShellInput).toHaveBeenCalledTimes(1)
  }, 30000)

  // 고치는 중에 같은 실패가 또 나면 **멈추고 설명한다** (설계 §4)
  it('고쳐도 같은 실패가 다시 나면 막혔다고 말하고 멈춘다', async () => {
    await announce()
    await wait(GRACE_MS)
    await emit(DEV.name, FAIL)
    expect(head()).toContain('못 고쳤습니다')

    await wait(WATCH_MS * 2)
    expect(sendShellInput).toHaveBeenCalledTimes(1)
    // 설명은 사용자가 닫을 때까지 남는다 — 알아서 사라지면 아무도 못 본다
    expect(head()).toContain('못 고쳤습니다')
  })
})

describe('남의 것은 안 건드린다', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // 사용자가 손으로 연 셸 칸은 실행 목록에 이름이 없다. 거기에 명령을 밀어 넣으면
  // 쳐 두던 글자와 섞인다 (`pidStore`·`ptyPool` 의 "우리가 만든 것만 만진다" 와 같은 규칙)
  it('실행 목록에 없는 칸은 예고도 조치도 없다', async () => {
    render(<Probe id="A" entries={[DEV]} />)
    await emit('셸', FAIL)
    await wait(GRACE_MS * 2)
    expect(head()).toBe('-')
    expect(sendShellInput).not.toHaveBeenCalled()
  })

  // `/api/event` 처럼 드로어 출력도 겉봉으로 신원이 온다 — 대조를 빼면 남의 프로젝트
  // 로그로 이 프로젝트의 칸에 명령이 들어간다
  it('다른 프로젝트의 출력은 무시한다', async () => {
    render(<Probe id="A" entries={[DEV]} />)
    await emit(DEV.name, FAIL, 'B')
    await wait(GRACE_MS * 2)
    expect(head()).toBe('-')
    expect(sendShellInput).not.toHaveBeenCalled()
  })

  // ⚠️ `sendShellInput` 은 main 에서 **활성 프로젝트**로 풀린다 — 옮긴 뒤에 쓰면 같은 이름을
  // 가진 남의 칸에 명령이 들어간다. 예고 중 프로젝트를 옮기면 회전이 통째로 없던 일이다.
  it('예고 중에 프로젝트를 옮기면 조치가 안 나간다', async () => {
    const view = render(<Probe id="A" entries={[DEV]} />)
    await emit(DEV.name, FAIL)
    expect(head()).toContain('npm install')

    view.rerender(<Probe id="B" entries={[DEV]} />)
    await wait(GRACE_MS * 2)
    expect(sendShellInput).not.toHaveBeenCalled()
    expect(head()).toBe('-')
  })
})
