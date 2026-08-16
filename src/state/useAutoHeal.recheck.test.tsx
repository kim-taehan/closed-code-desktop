// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoHeal, RECHECK_MS } from './useAutoHeal'
import type { ProjectStatus } from './projectStatus'

// **주기 재측정** — `useAutoHeal.test.tsx` 에서 갈라냈다 (300줄 상한).
//
// 가른 자리는 **한 회전 안**과 **회전들 사이**다. 저쪽은 "한 바퀴가 어떻게 도나" 를 보고
// 여기는 "그 바퀴가 끝난 뒤 30초마다 무슨 일이 있나" 를 본다 — 이쪽만 가짜 타이머로
// 100초를 돌려야 해서 시험 모양 자체가 다르다.

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
  // 서버·모델은 멀쩡하고 세션만 안 붙는다 — 사다리를 manual 까지 태우는 자리
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

// ⭐⭐ **재측정이 살아 있는가 — 시간이 지나야 드러나는 부류다.**
//
// 한때 타이머의 근거가 `pipeline?.verdict === 'manual'` 이었다. 재측정 회전은 치유 칸
// **앞에서** 멈춰 `verdict:null` 로 끝나므로 **자기가 서 있던 조건을 스스로 지웠고**,
// effect 가 정리되며 타이머가 다시 안 걸렸다 (실측 2026-08-16: 100초에 31.2s 한 번뿐).
//
// **한 창만 보는 시험은 이걸 못 잡는다** — 첫 30초는 멀쩡히 돌기 때문이다. 그래서 여기서는
// 가짜 타이머로 **100초를 돌린다.** 이 시험이 없으면 설계 §2 의 *"VPN 을 켜면 스스로 초록이
// 된다"* 가 첫 창에서만 참인 채로 조용히 돌아온다.
describe('주기 재측정은 계속 돈다', () => {
  /** 사다리를 태워 `manual` 로 멈춘 자리까지 (가짜 타이머로 폴링을 흘려보낸다) */
  async function untilStopped() {
    render(<Probe id="A" status="disconnected" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
  }

  it('100초 동안 30초마다 잰다 — 한 번 돌고 죽지 않는다', async () => {
    vi.useFakeTimers()
    try {
      await untilStopped()
      const base = davis.pingServer.mock.calls.length

      const marks: number[] = []
      for (let round = 0; round < 3; round += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(RECHECK_MS)
        })
        marks.push(davis.pingServer.mock.calls.length - base)
      }
      // 30·60·90초에 한 번씩 — 고치기 전에는 [1, 1, 1] 이었다
      expect(marks).toEqual([1, 2, 3])
    } finally {
      vi.useRealTimers()
    }
  }, 30000)

  // 재측정이 초록을 보면 그때 자격이 돌아오고 화면이 비워진다 (설계 §2 의 VPN 시나리오)
  it('늦게 살아나도 스스로 초록이 된다', async () => {
    vi.useFakeTimers()
    try {
      await untilStopped()
      expect(screen.getByTestId('stage').textContent).toBe('doctor')

      // 90초쯤 지나 사내망이 붙었다 — 세션은 아직 prop 으로 disconnected 지만 진단은 초록이다
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECHECK_MS * 2)
      })
      davis.diagnose.mockResolvedValue({ runtime: { ok: true, detail: '정상' } })
      const healed = davis.pingServer.mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECHECK_MS)
      })
      // 그 시점에도 재고 있었다 — 죽어 있었으면 여기서 안 늘어난다
      expect(davis.pingServer.mock.calls.length).toBeGreaterThan(healed)
    } finally {
      vi.useRealTimers()
    }
  }, 30000)

  // ⭐ **하지 않을 일을 예고하지 않는다.**
  //
  // `healNotice` 는 `state.next` 를 「이제 할 일」로 읽는데, 진단 전용 회전에서 `next` 는
  // 「여기서 멈췄다」다. 그 상태를 화면에 먹이면 "이 프로젝트용 서버를 새로 띄웁니다…" 라고
  // 적고 **안 띄운다** — 설계 §3 의 축이 예고인데 그 예고가 거짓이 된다. 게다가 승격이
  // 창 → 배너로 **거꾸로** 간다.
  it('재측정 회전은 화면을 건드리지 않는다', async () => {
    vi.useFakeTimers()
    try {
      await untilStopped()
      expect(screen.getByTestId('stage').textContent).toBe('doctor')
      const settled = headline()

      for (let round = 0; round < 3; round += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(RECHECK_MS)
        })
        // 승격이 거꾸로 가지 않는다
        expect(screen.getByTestId('stage').textContent).toBe('doctor')
        // 마지막 사다리 결과가 그대로 남는다 — 재측정이 덮어쓰지 않는다
        expect(headline()).toBe(settled)
        // 그리고 안 할 일을 예고하지 않는다
        expect(headline()).not.toContain('띄웁니다')
      }
    } finally {
      vi.useRealTimers()
    }
  }, 30000)
})
