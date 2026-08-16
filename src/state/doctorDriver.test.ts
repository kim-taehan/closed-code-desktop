// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { driveDoctor } from './doctorDriver'
import type { PipelineState } from './doctorPipeline'
import type { ProjectStatus } from './projectStatus'

// **머신과 IPC 사이의 배선을 잠근다.**
//
// 두 층은 각각 이미 잠겨 있다 — 어느 칸으로 가는지는 `doctorPipeline.test.ts` 가,
// 원인 문장과 버튼은 `connectionDoctor.test.ts` 가 본다. 그런데 **층이 잠겼다는 것과
// 층 사이가 이어졌다는 것은 다른 물음이다**: 매핑이 옳아도 `heal-adopt-server` 가
// `stop` 을 부르면 남의 서버가 죽는다. 그 한 칸을 여기서 본다.
//
// 컴포넌트 없이 돈다. 그래서 재확인 간격을 주입해(`recheckIntervalMs`) 3초짜리 시험이
// 안 된다 — 화면 시험(`ConnectionDoctor.test.tsx`)이 못 하는 것이 이것이다.

const davis = {
  pingServer: vi.fn(),
  checkModels: vi.fn(),
  diagnose: vi.fn(),
  reconnectProject: vi.fn(),
  serverStatus: vi.fn(),
  controlServer: vi.fn(),
}

/** 서버 주인 판정 — main 이 `pidStore` 로 내는 답을 흉내낸다 */
function ownedByUs(ours: boolean) {
  davis.serverStatus.mockResolvedValue({ running: ours, url: 'http://127.0.0.1:4096', pid: ours ? 42 : null, ours })
}

beforeEach(() => {
  for (const fn of Object.values(davis)) fn.mockReset()
  davis.pingServer.mockResolvedValue({ ok: true, detail: '4096 응답' })
  davis.checkModels.mockResolvedValue({ ok: true, message: 'ollama-local (1)' })
  davis.diagnose.mockResolvedValue({ runtime: { ok: true, detail: '정상' } })
  davis.reconnectProject.mockResolvedValue(undefined)
  davis.controlServer.mockResolvedValue({
    ok: true,
    status: { running: true, url: 'http://127.0.0.1:4096', pid: 42, ours: true },
  })
  ownedByUs(false)
  ;(window as unknown as { davis: unknown }).davis = davis
})

/** 세션이 끝까지 안 붙는 자리 — 사다리를 끝까지 태운다 */
function drive(status: ProjectStatus = 'disconnected', healing = true): Promise<PipelineState> {
  return driveDoctor({
    getStatus: () => status,
    onState: () => {},
    shouldStop: () => false,
    healing,
    recheckIntervalMs: 0,
  })
}

const actions = () => davis.controlServer.mock.calls.map(([payload]) => payload.action)

describe('진단 — 어느 단계가 어떤 IPC 를 부르나', () => {
  it('server → model → session 순으로 부른다', async () => {
    await drive('ready')
    expect(davis.pingServer).toHaveBeenCalled()
    expect(davis.checkModels).toHaveBeenCalled()
    expect(davis.diagnose).toHaveBeenCalled()
  })

  it('전부 정상이면 치유를 하나도 안 부른다', async () => {
    const state = await drive('ready')
    expect(state.verdict).toBe('healthy')
    expect(davis.reconnectProject).not.toHaveBeenCalled()
    expect(davis.controlServer).not.toHaveBeenCalled()
  })

  // 모델은 **우리가 못 고치는 층**이다 — 사다리를 타지 않는다 (설계 §1)
  it('모델이 없으면 사다리를 타지 않는다', async () => {
    davis.checkModels.mockResolvedValue({ ok: false, message: '설정된 모델이 없습니다' })
    const state = await drive()
    expect(state.verdict).toBe('manual')
    expect(davis.controlServer).not.toHaveBeenCalled()
    expect(davis.reconnectProject).not.toHaveBeenCalled()
  })
})

// ⭐ **여기가 「남의 서버는 끄지 않는다」의 배선 시험이다.**
describe('② 서버 되살리기 — 주인에 따라 다른 조치를 부른다', () => {
  it('우리가 띄운 서버면 restart 다', async () => {
    ownedByUs(true)
    await drive()
    expect(actions()).toEqual(['restart'])
  })

  // `start` 는 **아무것도 끄지 않는다.** 남의 서버는 그대로 살아 있고 이 프로젝트만 옮긴다.
  it('남이 띄운 서버면 start 다', async () => {
    ownedByUs(false)
    await drive()
    expect(actions()).toEqual(['start'])
  })

  // **모르면 남의 것으로 본다** — main 이 답을 못 주는 경우까지 그렇다
  it('주인을 못 물으면 start 다 (안전한 쪽으로 틀린다)', async () => {
    davis.serverStatus.mockRejectedValue(new Error('창이 없다'))
    await drive()
    expect(actions()).toEqual(['start'])
  })

  // 어느 갈래로 가든 **끄는 호출은 나가지 않는다.** 사다리에 `stop` 이 낄 자리가 없다.
  it('어느 갈래도 stop 을 부르지 않는다', async () => {
    for (const ours of [true, false]) {
      davis.controlServer.mockClear()
      ownedByUs(ours)
      await drive()
      expect(actions()).not.toContain('stop')
    }
  })

  // 서버가 죽은 채로 재연결하면 같은 자리에서 또 실패한다 — ①을 건너뛴다.
  // **③의 재연결은 그대로 나간다**: 그래서 "안 부른다" 가 아니라 "①이 먼저 안 나간다" 를 본다.
  it('서버 진단이 실패하면 재연결을 건너뛰고 곧장 ②로 간다', async () => {
    davis.pingServer.mockResolvedValue({ ok: false, detail: '연결 거부' })
    ownedByUs(true)
    await drive()
    expect(actions()).toEqual(['restart'])
    // ③ 한 번뿐이다 — ①이 돌았으면 둘이 된다
    expect(davis.reconnectProject).toHaveBeenCalledTimes(1)
    expect(davis.controlServer.mock.invocationCallOrder[0]).toBeLessThan(
      davis.reconnectProject.mock.invocationCallOrder[0]!,
    )
  })

  it('서버를 못 띄우면 그 사유가 그대로 판정에 실린다', async () => {
    davis.controlServer.mockResolvedValue({
      ok: false,
      error: 'opencode 실행 파일을 찾지 못했습니다',
      status: { running: false, url: null, pid: null, ours: false },
    })
    const state = await drive()
    expect(state.verdict).toBe('manual')
    const failed = state.steps.find((step) => step.id === 'heal-adopt-server')
    expect(failed?.detail).toBe('opencode 실행 파일을 찾지 못했습니다')
  })
})

// ⭐⭐ **이 describe 가 없으면 재시작 루프가 조용히 산다** (설계 §5).
describe('한 바퀴가 상한이다', () => {
  it('①②③ 을 전부 실패해도 서버 조작은 한 번뿐이다', async () => {
    ownedByUs(true)
    const state = await drive()
    expect(davis.controlServer).toHaveBeenCalledTimes(1)
    expect(state.verdict).toBe('manual')
    expect(state.next).toBeNull()
  })

  // ①과 ③ — 재연결은 두 번 나간다. 그것이 설계의 세 칸이다.
  it('재연결은 서버를 되살린 앞뒤로 한 번씩 나간다', async () => {
    ownedByUs(true)
    await drive()
    expect(davis.reconnectProject).toHaveBeenCalledTimes(2)
  })
})

// 30초 주기 재측정 — **진단만 잰다.** 치유까지 하면 1회 상한이 30초마다 무너진다 (설계 §2).
describe('healing: false — 진단만 재고 멈춘다', () => {
  it('세션이 죽어 있어도 아무 조치도 안 부른다', async () => {
    const state = await drive('disconnected', false)
    expect(davis.reconnectProject).not.toHaveBeenCalled()
    expect(davis.controlServer).not.toHaveBeenCalled()
    // 진단 자체는 다 돌았다 — 살아났는지를 알 수 있어야 자격이 회복된다
    expect(davis.pingServer).toHaveBeenCalled()
    expect(davis.diagnose).toHaveBeenCalled()
    expect(state.verdict).toBeNull()
  })

  it('서버가 죽어 있어도 되살리지 않는다', async () => {
    davis.pingServer.mockResolvedValue({ ok: false, detail: '연결 거부' })
    await drive('disconnected', false)
    expect(davis.controlServer).not.toHaveBeenCalled()
  })

  it('전부 정상이면 healthy 로 끝난다 — 이 판정이 자동 자격을 되돌린다', async () => {
    const state = await drive('ready', false)
    expect(state.verdict).toBe('healthy')
  })
})

describe('중지 — shouldStop 은 그 자리에서 끊는다', () => {
  it('첫 단계 뒤에 멈추면 다음 IPC 가 안 나간다', async () => {
    let calls = 0
    await driveDoctor({
      getStatus: () => 'disconnected',
      onState: () => {},
      shouldStop: () => {
        calls += 1
        // 첫 단계(server)를 끝낸 직후의 물음에서 참이 된다
        return calls > 1
      },
      recheckIntervalMs: 0,
    })
    expect(davis.checkModels).not.toHaveBeenCalled()
    expect(davis.controlServer).not.toHaveBeenCalled()
  })
})
