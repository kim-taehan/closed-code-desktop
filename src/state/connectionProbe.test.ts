// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { awaitHealthy, probeModels, probeRuntime, probeServer } from './connectionProbe'
import type { ProjectStatus } from './projectStatus'

// 렌더러 쪽 "호출 + 결과 해석". **어느 단계가 무엇을 부르는가**를 잠근다.
//
// 실제 URL 은 main 이 만든다 (`electron/opencode/probe.ts` — 그쪽 테스트가 URL 을 본다).
// 여기서 잠그는 것은 **어느 IPC 로 가는가**와 **응답을 CheckOutcome 으로 어떻게 옮기는가**다.
// `checkModels` 는 `{ok, message}` 로 오는데 머신은 `{ok, detail}` 을 먹는다 — 이 이름 바꿈이
// 조용히 틀리면 화면의 사유 칸이 통째로 빈다.

const davis = {
  diagnose: vi.fn(),
  pingServer: vi.fn(),
  checkModels: vi.fn(),
}

// ⚠️ **가짜 타이머를 쓰지 않는다.** `awaitHealthy` 는 폴링 사이에 `setTimeout` 으로 쉬는데,
// 가짜 타이머를 걸면 그 `sleep` 이 영영 안 깨어 케이스가 통째로 타임아웃된다.
// `intervalMs: 0` 으로 주면 실제 타이머로도 즉시 돌아온다.
beforeEach(() => {
  davis.diagnose.mockReset()
  davis.pingServer.mockReset()
  davis.checkModels.mockReset()
  ;(window as unknown as { davis: unknown }).davis = davis
})

const diag = (ok: boolean, detail = '') => ({ runtime: { ok, detail } })

describe('probeServer — server 단계', () => {
  it('pingServer 로 간다', async () => {
    davis.pingServer.mockResolvedValue({ ok: true, detail: '4096 응답' })
    expect(await probeServer()).toEqual({ ok: true, detail: '4096 응답' })
    expect(davis.pingServer).toHaveBeenCalledWith({})
  })

  // 폼에 친 주소로 미리 확인하는 길 — 저장 전에 시험해 볼 수 있어야 한다
  it('주소를 주면 그대로 넘긴다', async () => {
    davis.pingServer.mockResolvedValue({ ok: true, detail: '' })
    await probeServer({ opencodeUrl: 'http://other:9999' })
    expect(davis.pingServer).toHaveBeenCalledWith({ opencodeUrl: 'http://other:9999' })
  })
})

describe('probeModels — model 단계', () => {
  // **message → detail** 로 옮긴다. 여기가 틀리면 사유 칸이 undefined 가 된다.
  it('checkModels 의 message 를 detail 로 옮긴다', async () => {
    davis.checkModels.mockResolvedValue({ ok: true, message: 'ollama-local (1)' })
    expect(await probeModels()).toEqual({ ok: true, detail: 'ollama-local (1)' })
  })

  it('실패 사유도 그대로 옮긴다', async () => {
    davis.checkModels.mockResolvedValue({ ok: false, message: '설정된 모델이 없습니다' })
    expect(await probeModels()).toEqual({ ok: false, detail: '설정된 모델이 없습니다' })
  })
})

describe('probeRuntime — session 단계', () => {
  it('진단 전체를 함께 돌려준다 — Doctor 가 수동 이슈 판정에 쓴다', async () => {
    davis.diagnose.mockResolvedValue(diag(true, '정상'))
    const { outcome, diag: payload } = await probeRuntime()

    expect(outcome).toEqual({ ok: true, detail: '정상' })
    expect(payload).toEqual(diag(true, '정상'))
  })
})

describe('awaitHealthy — 치유 뒤 재확인', () => {
  const ready = (): ProjectStatus => 'ready'
  const dead = (): ProjectStatus => 'disconnected'

  it('런타임과 세션이 둘 다 살면 즉시 통과한다', async () => {
    davis.diagnose.mockResolvedValue(diag(true))
    const result = await awaitHealthy(ready, { tries: 3, intervalMs: 0 })

    expect(result.ok).toBe(true)
    expect(davis.diagnose).toHaveBeenCalledTimes(1)
  })

  // **런타임만 살아난 것으로는 부족하다** — 세션이 붙어야 대화가 된다
  it('런타임이 살아도 세션이 죽어 있으면 계속 기다린다', async () => {
    davis.diagnose.mockResolvedValue(diag(true))
    const result = await awaitHealthy(dead, { tries: 3, intervalMs: 0 })

    expect(result.ok).toBe(false)
    expect(result.detail).toBe('재확인 시간 안에 연결되지 않았습니다')
    expect(davis.diagnose).toHaveBeenCalledTimes(3)
  })

  it('도중에 살아나면 남은 횟수를 안 쓴다', async () => {
    davis.diagnose.mockResolvedValueOnce(diag(false)).mockResolvedValue(diag(true))
    const result = await awaitHealthy(ready, { tries: 5, intervalMs: 0 })

    expect(result.ok).toBe(true)
    expect(davis.diagnose).toHaveBeenCalledTimes(2)
  })

  // 화면이 닫힌 뒤에도 폴링이 돌면 유령 요청이 남는다
  it('shouldStop 이 참이면 한 번도 안 부르고 그만둔다', async () => {
    davis.diagnose.mockResolvedValue(diag(true))
    const result = await awaitHealthy(ready, { tries: 5, intervalMs: 0, shouldStop: () => true })

    expect(result.ok).toBe(false)
    expect(davis.diagnose).not.toHaveBeenCalled()
  })

  it('폴링마다 진단을 밖으로 흘려 준다 — Doctor 의 lastDiag 가 이걸로 갱신된다', async () => {
    davis.diagnose.mockResolvedValue(diag(false, '연결 거부'))
    const seen: unknown[] = []
    await awaitHealthy(dead, { tries: 2, intervalMs: 0, onDiag: (payload) => seen.push(payload) })

    expect(seen).toHaveLength(2)
    expect(seen[0]).toEqual(diag(false, '연결 거부'))
  })
})
