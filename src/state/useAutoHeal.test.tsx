// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoHeal, RECHECK_MS } from './useAutoHeal'
import type { ProjectStatus } from './projectStatus'

// **자동 실행 규칙을 잠근다** (설계 2026-08-16 §2) — 언제 시작하나 · 몇 번 도나.
//
// 사다리가 무엇을 부르는지는 `doctorDriver.test.ts` 가 본다. 여기서 보는 것은 **시간**이다:
// 같은 사다리라도 자동으로 반복해서 태우면 서버 재시작이 무한히 나간다.
//
// ⭐ **「한 바퀴가 상한」 시험이 이 파일의 존재 이유다.** 그 잠금이 없으면 재시작 루프가
// 조용히 산다 — 타입체크도 다른 테스트도 못 본다. 한 바퀴만 보면 전부 정상이기 때문이다.

afterEach(cleanup)

const davis = {
  pingServer: vi.fn(),
  checkModels: vi.fn(),
  diagnose: vi.fn(),
  reconnectProject: vi.fn(),
  serverStatus: vi.fn(),
  controlServer: vi.fn(),
}

beforeEach(() => {
  for (const fn of Object.values(davis)) fn.mockReset()
  // 서버·모델은 멀쩡하고 세션만 안 붙는다 — 사다리를 끝까지 태우는 자리
  davis.pingServer.mockResolvedValue({ ok: true, detail: '4096 응답' })
  davis.checkModels.mockResolvedValue({ ok: true, message: 'ollama-local (1)' })
  davis.diagnose.mockResolvedValue({ runtime: { ok: true, detail: '정상' } })
  davis.reconnectProject.mockResolvedValue(undefined)
  davis.serverStatus.mockResolvedValue({ running: true, url: 'u', pid: 42, ours: true })
  davis.controlServer.mockResolvedValue({ ok: true, status: { running: true, url: 'u', pid: 42, ours: true } })
  ;(window as unknown as { davis: unknown }).davis = davis
})

function Probe({ id, status }: { id?: string; status?: ProjectStatus }) {
  const heal = useAutoHeal(id, status)
  return (
    <>
      <span data-testid="stage">{heal.notice?.stage ?? '-'}</span>
      <span data-testid="headline">{heal.notice?.headline ?? '-'}</span>
    </>
  )
}

const headline = () => screen.getByTestId('headline').textContent ?? ''

/** 사다리 한 바퀴가 끝날 때까지 (재확인 1초 × 3 이 두 번 낀다) */
async function settle(ms = 8000) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

describe('언제 시작하나', () => {
  it('ready 에서는 안 돈다', async () => {
    render(<Probe id="A" status="ready" />)
    await settle(100)
    expect(davis.pingServer).not.toHaveBeenCalled()
  })

  // **connecting 은 진행 중이다** — 건드리면 도는 것을 끊고 다시 시작하는 꼴이 된다
  it('connecting 에서는 안 돈다', async () => {
    render(<Probe id="A" status="connecting" />)
    await settle(100)
    expect(davis.pingServer).not.toHaveBeenCalled()
  })

  // idle 은 **아직 안 붙어 본 것**이라 고칠 대상이 없다 (`useDoctorGate` 의 표와 같은 결)
  it('idle 에서는 안 돈다', async () => {
    render(<Probe id="A" status="idle" />)
    await settle(100)
    expect(davis.pingServer).not.toHaveBeenCalled()
  })

  it('disconnected 에서 돈다', async () => {
    render(<Probe id="A" status="disconnected" />)
    await settle(200)
    expect(davis.pingServer).toHaveBeenCalled()
  })

  it('error 에서 돈다', async () => {
    render(<Probe id="A" status="error" />)
    await settle(200)
    expect(davis.pingServer).toHaveBeenCalled()
  })

  it('열린 창이 있으면(enabled=false) 시작하지 않는다', async () => {
    function Off() {
      useAutoHeal('A', 'error', { enabled: false })
      return null
    }
    render(<Off />)
    await settle(200)
    expect(davis.pingServer).not.toHaveBeenCalled()
  })
})

// ⭐⭐ 이 describe 가 재시작 루프를 막는다
describe('한 바퀴가 상한이다', () => {
  it('사다리가 실패해도 자동으로 다시 타지 않는다', async () => {
    const view = render(<Probe id="A" status="disconnected" />)
    await settle()
    expect(davis.controlServer).toHaveBeenCalledTimes(1)

    // 상태가 계속 깨져 있어도(리렌더가 몇 번을 오가도) 두 번째 바퀴는 없다
    for (const status of ['error', 'disconnected', 'error'] as ProjectStatus[]) {
      view.rerender(<Probe id="A" status={status} />)
      await settle(200)
    }
    expect(davis.controlServer).toHaveBeenCalledTimes(1)
  }, 20000)

  // 주기 재측정은 **진단만** 잰다. 여기서 치유가 나가면 30초마다 서버가 재시작된다.
  it('30초 재측정은 치유를 부르지 않는다', async () => {
    vi.useFakeTimers()
    try {
      render(<Probe id="A" status="disconnected" />)
      // 첫 바퀴를 태운다 (fake timer 라 재확인 폴링도 여기서 흘려보낸다)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      const healCalls = davis.controlServer.mock.calls.length
      const probeCalls = davis.pingServer.mock.calls.length

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECHECK_MS * 2 + 1000)
      })
      // 진단은 다시 쟀고 — 살아났는지 알아야 자격이 회복된다
      expect(davis.pingServer.mock.calls.length).toBeGreaterThan(probeCalls)
      // 치유는 한 번도 더 안 나갔다
      expect(davis.controlServer.mock.calls.length).toBe(healCalls)
    } finally {
      vi.useRealTimers()
    }
  }, 20000)
})

// ⭐⭐ **주인 판정이 사용자가 볼 문장까지 닿는가.**
//
// 순수 함수는 `healNotice.test.ts` 가 두 갈래 다 잠갔고, 포트는 `doctorDriver.test.ts` 가
// 잠갔다. **그래도 그 사이가 이어졌는지는 아직 다른 물음이다** — `onOwnership` 을 안 걸거나
// `healNotice` 에 안 넘겨도 **조치는 그대로 옳고 사다리도 통과한다.** 빨개지는 시험이
// 하나도 없이 사용자만 늘 한쪽 문장을 본다.
//
// ⚠️ QA 가 실물에서 「우리 것」 갈래를 못 밟았다 (2026-08-16): 크래시 경로는 `forgetDead` 가
// 표를 비운 뒤라 언제나 `theirs` 이고, 반대 갈래는 **서버는 살아 있는데 세션만 깨진** 경우라
// 진단이 `model` 층까지 초록이어야 도달한다. 사내 프록시가 안 닿는 기계에서는 거기서 끝난다.
// **실물에서 못 밟는 갈래일수록 여기서 밟아 둬야 한다.**
describe('주인 판정이 문장까지 닿는다', () => {
  /** 서버·모델은 멀쩡하고 **세션만** 깨진 자리 — 「우리 것」 갈래가 사는 유일한 경로 */
  function serverAlive(ours: boolean) {
    davis.serverStatus.mockResolvedValue({ running: ours, url: 'u', pid: ours ? 42 : null, ours })
    // ②에서 멈춰 세운다 — 그 칸의 문장을 봐야 한다
    davis.controlServer.mockImplementation(() => new Promise(() => {}))
  }

  // ⚠️ **약속 문구(「남의 것에 손대지 않는다」)를 여기서 겨누지 않는다.**
  //
  // 그 낱말은 이미 두 번 갈렸고(`3599d87` → `01aa781`), 두 번째 때 이 배선 시험까지 함께
  // 빨개져 리더가 문자열 셋을 고쳐야 했다. **문장의 내용은 `healNotice.test.ts` 가 본다** —
  // 여기서 또 겨누면 사본이 하나 더 늘고, 문구를 고칠 때마다 정작 이 시험이 겨누는 것
  // (**주인 판정이 갈래를 실제로 갈랐는가**)이 문구 관리에 묻힌다.
  //
  // 그래서 두 갈래를 **서로 다른 문장인가**로 가른다. 판정이 안 닿으면 둘이 같아진다.
  it('우리가 띄운 서버면 「다시 띄운다」 쪽 문장이 나온다', async () => {
    serverAlive(true)
    render(<Probe id="A" status="disconnected" />)
    // ①(재연결 재확인 1초 × 3)이 실패해야 ②로 내려간다
    await settle(5000)
    expect(headline()).toContain('재연결이 실패했습니다')
    expect(headline()).toContain('다시 띄웁니다')
  }, 20000)

  it('우리 것이 아니면 「새로 띄운다」 쪽 문장이 나온다 — 같은 문장이 아니다', async () => {
    serverAlive(false)
    render(<Probe id="A" status="disconnected" />)
    await settle(5000)
    expect(headline()).toContain('이 프로젝트용 서버를')
    // 판정이 안 닿으면 위 시험과 같은 문장이 나온다 — 그 자리를 겨눈다
    expect(headline()).not.toContain('재연결이 실패했습니다')
  }, 20000)
})

// 살아나면 자격이 돌아온다 — 다음에 또 깨지면 다시 한 바퀴 탄다 (설계 §2).
// 안 그러면 사용자가 한 번 고친 뒤로는 자가 복구가 영영 안 돈다.
describe('살아나면 자격이 돌아온다', () => {
  it('ready 를 거치면 다음 고장에서 다시 탄다', async () => {
    const view = render(<Probe id="A" status="disconnected" />)
    await settle()
    expect(davis.controlServer).toHaveBeenCalledTimes(1)

    view.rerender(<Probe id="A" status="ready" />)
    await settle(200)
    view.rerender(<Probe id="A" status="disconnected" />)
    await settle()
    expect(davis.controlServer).toHaveBeenCalledTimes(2)
  }, 30000)
})

// 도는 사다리에는 **주인이 있다.** 주인이 사라지면 거둔다 — 안 그러면 닫은 프로젝트의
// 서버가 뒤늦게 다시 뜨고, 도중에 세는 자리가 없어 조용하다.
describe('주인이 사라지면 거둔다', () => {
  it('화면이 사라지면 그 뒤로 조치가 안 나간다', async () => {
    const view = render(<Probe id="A" status="disconnected" />)
    // ①의 재확인 폴링이 도는 중에 끊는다
    await settle(300)
    view.unmount()
    await settle(6000)
    expect(davis.controlServer).not.toHaveBeenCalled()
  }, 20000)

  it('프로젝트를 바꾸면 앞 프로젝트의 사다리가 멈춘다', async () => {
    const view = render(<Probe id="A" status="disconnected" />)
    await settle(300)
    view.rerender(<Probe id="B" status="ready" />)
    await settle(6000)
    // B 는 ready 라 안 돌고, A 의 사다리는 거둬졌다
    expect(davis.controlServer).not.toHaveBeenCalled()
  }, 20000)
})

describe('프로젝트를 바꾸면', () => {
  it('새 프로젝트는 자기 몫의 한 바퀴를 갖는다', async () => {
    const view = render(<Probe id="A" status="disconnected" />)
    await settle()
    expect(davis.controlServer).toHaveBeenCalledTimes(1)

    view.rerender(<Probe id="B" status="disconnected" />)
    await settle()
    expect(davis.controlServer).toHaveBeenCalledTimes(2)
  }, 30000)
})
