// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionDoctor } from './ConnectionDoctor'
import { advance, initPipeline } from '../state/doctorPipeline'

// 드라이버 — 순수 머신(`doctorPipeline`)에 **부작용을 실제로 먹이는** 자리.
//
// 머신 자체는 `doctorPipeline.test.ts` 가 잠갔다. 여기서 잠그는 것은 그 사이의 배선이다:
// 어느 단계가 어떤 IPC 를 부르는가 · 5상이 화면에 어떤 표식으로 나오는가 ·
// 초록으로 끝나면 `onHealthy` 가 불리는가(자동 닫힘 게이트가 이 신호를 쓴다).

afterEach(cleanup)

const davis = {
  pingServer: vi.fn(),
  checkModels: vi.fn(),
  diagnose: vi.fn(),
  reconnectProject: vi.fn(),
  // 사다리 ②가 부르는 것들. **`serverStatus.ours` 가 갈래를 정한다** — main 이 `pidStore`
  // 로 낸 판정이고, 화면은 그것을 다시 재지 않는다.
  serverStatus: vi.fn(),
  controlServer: vi.fn(),
}

/** 셋 다 통과하는 평범한 성공 */
function allGood() {
  davis.pingServer.mockResolvedValue({ ok: true, detail: '4096 응답' })
  davis.checkModels.mockResolvedValue({ ok: true, message: 'ollama-local (1)' })
  davis.diagnose.mockResolvedValue({ runtime: { ok: true, detail: '정상' } })
}

/** 서버 주인 판정. 기본은 **남의 것** — 모르면 그쪽으로 본다 */
function ownedByUs(ours: boolean) {
  davis.serverStatus.mockResolvedValue({ running: ours, url: 'http://127.0.0.1:4096', pid: ours ? 42 : null, ours })
}

beforeEach(() => {
  for (const fn of Object.values(davis)) fn.mockReset()
  davis.reconnectProject.mockResolvedValue(undefined)
  // **기본을 깔아 둔다.** 사다리가 ③까지 내려가면 재확인이 `diagnose` 를 부르는데,
  // 안 깔면 `undefined` 를 읽다 터지고 증상이 "아무것도 안 그려진다" 로만 보인다.
  davis.diagnose.mockResolvedValue({ runtime: { ok: false, detail: '응답 없음' } })
  ownedByUs(false)
  davis.controlServer.mockResolvedValue({
    ok: true,
    status: { running: true, url: 'http://127.0.0.1:4096', pid: 42, ours: true },
  })
  ;(window as unknown as { davis: unknown }).davis = davis
})

function renderDoctor(props: Partial<Parameters<typeof ConnectionDoctor>[0]> = {}) {
  const onHealthy = vi.fn()
  // `fix` 는 왼쪽(연결) 열을 여는 스위치다. 예전에는 설정과 저장 함수가 왔다 —
  // 그 열이 주소를 고치는 곳이었을 때다 (`ConnectionFixForm` 머리말).
  render(<ConnectionDoctor status="ready" onHealthy={onHealthy} fix {...props} />)
  return { onHealthy }
}

/** 단계 줄의 표식(·/…/✓/✗/–) — 5상이 화면에 나오는 모양 */
function marks(): string[] {
  return [...document.querySelectorAll('.dc-doctor__step-mark')].map((node) => node.textContent ?? '')
}

describe('열면 곧바로 진단이 돈다', () => {
  it('세 단계를 순서대로 부른다', async () => {
    allGood()
    renderDoctor()

    await vi.waitFor(() => expect(davis.diagnose).toHaveBeenCalled())
    expect(davis.pingServer).toHaveBeenCalled()
    expect(davis.checkModels).toHaveBeenCalled()
  })

  it('셋 다 통과하면 정상이라고 적는다', async () => {
    allGood()
    renderDoctor()
    await vi.waitFor(() => expect(screen.getByText(/연결이 정상입니다/)).toBeTruthy())
    expect(marks()).toEqual(['✓', '✓', '✓'])
  })

  // **초록으로 끝났다는 신호** — 최초 등록 게이트가 이걸로 자동 닫힘한다 (D3 이 쓸 자리)
  it('초록으로 끝나면 onHealthy 를 부른다', async () => {
    allGood()
    const { onHealthy } = renderDoctor()
    await vi.waitFor(() => expect(onHealthy).toHaveBeenCalled())
  })
})

describe('실패 — 5상이 화면에 그대로 나온다', () => {
  // **표식이 셋이었다** — 서버가 죽으면 거기서 끝났기 때문이다. 이제 그 뒤에 치유 칸이
  // 붙으므로 **앞 셋만** 본다. 진단 세 칸의 모양은 그대로다.
  it('서버가 죽으면 ✗ 하나에 – 둘이고, 뒤 진단 단계는 부르지 않는다', async () => {
    davis.pingServer.mockResolvedValue({ ok: false, detail: '연결 거부' })
    renderDoctor()

    await vi.waitFor(() => expect(marks().slice(0, 3)).toEqual(['✗', '–', '–']))
    // 서버가 죽었으면 모델은 볼 것이 없다.
    // **`diagnose` 는 여기서 뺐다** — 치유 ③의 재확인이 그것을 부르기 때문에 이제
    // "안 불린다" 가 거짓이다. 진단 단계로서 안 돌았다는 것은 위 `–` 두 개가 말한다.
    expect(davis.checkModels).not.toHaveBeenCalled()
  })

  it('blocked 단계에는 「앞 단계가 실패해 확인할 수 없습니다」가 붙는다', async () => {
    davis.pingServer.mockResolvedValue({ ok: false, detail: '연결 거부' })
    renderDoctor()

    await vi.waitFor(() =>
      expect(screen.getAllByText('앞 단계가 실패해 확인할 수 없습니다')).toHaveLength(2),
    )
  })

  // 사유는 **두 곳**에 나온다 — 단계 줄의 detail 과 아래 이슈 목록의 cause.
  // 일부러 둘 다 본다: 단계만 보면 "어디가" 는 알아도 "무엇을 하라" 가 없고,
  // 이슈만 보면 어느 단계에서 났는지가 없다.
  // 사다리를 끝까지 태운 뒤에야 이슈 목록이 나온다 — 재확인 폴링(1초 × 3)이 두 번 낀다
  it('사유가 단계 줄과 이슈 목록 양쪽에 나오고, 이슈에는 다음 행동이 붙는다', async () => {
    davis.pingServer.mockResolvedValue({ ok: false, detail: '연결 거부' })
    // 사다리를 다 타는 동안 서버는 계속 죽어 있다 — 두 곳이 같은 사유를 말해야 한다
    davis.diagnose.mockResolvedValue({ runtime: { ok: false, detail: '연결 거부' } })
    renderDoctor()

    await vi.waitFor(() => expect(document.querySelector('.dc-doctor__item')).toBeTruthy(), {
      timeout: 8000,
    })


    expect(document.querySelector('.dc-doctor__step-detail')?.textContent).toBe('연결 거부')
    expect(document.querySelector('.dc-doctor__cause')?.textContent).toBe('연결 거부')
    // 안내가 *"`opencode serve` 로 서버를 띄우세요"* 였다 — 현장 사용자에게 터미널이 없어
    // 못 따라 할 지시였고, 앱이 서버를 띄우게 되면서 조치 문장으로 바뀌었다.
    //
    // ⚠️ **문구를 낱말로 겨눈다** (`3599d87` 로 한 번 갈렸다: *"이미 떠 있는 다른 서버는
    // 그대로 둡니다"* → *"우리가 띄우지 않은 서버는 건드리지 않습니다"*). 여기서 지켜야 할
    // 것은 특정 문장이 아니라 **「남의 것에 손대지 않는다」는 약속이 안내에 남아 있는가**다.
    expect(document.querySelector('.dc-doctor__advice')?.textContent).toContain('건드리지 않습니다')
  }, 10000)

  // 모델 실패는 서버 실패와 다르다 — 서버는 ✓ 로 남고 세션만 – 다
  // 모델은 **사다리를 안 탄다** — 우리가 못 고치는 층이라 치유 칸이 안 붙는다 (설계 §1)
  it('모델이 없으면 ✓ ✗ – 이고 세션은 부르지 않는다', async () => {
    davis.pingServer.mockResolvedValue({ ok: true, detail: '4096 응답' })
    davis.checkModels.mockResolvedValue({ ok: false, message: '설정된 모델이 없습니다' })
    renderDoctor()

    await vi.waitFor(() => expect(marks()).toEqual(['✓', '✗', '–']))
    expect(davis.diagnose).not.toHaveBeenCalled()
    expect(davis.controlServer).not.toHaveBeenCalled()
    expect(davis.reconnectProject).not.toHaveBeenCalled()
  })

  it('실패로 끝나면 onHealthy 를 부르지 않는다', async () => {
    davis.pingServer.mockResolvedValue({ ok: false, detail: '연결 거부' })
    const { onHealthy } = renderDoctor()

    await vi.waitFor(() => expect(marks()[0]).toBe('✗'))
    expect(onHealthy).not.toHaveBeenCalled()
  }, 10000)
})

describe('자동 치유 — 세션만 죽었을 때', () => {
  // 세션이 죽은 상태로 열면 세 단계가 통과해도 치유 단계가 붙는다
  it('네 번째 단계(재연결)가 붙고 실제로 재연결을 부른다', async () => {
    davis.pingServer.mockResolvedValue({ ok: true, detail: '4096 응답' })
    davis.checkModels.mockResolvedValue({ ok: true, message: 'ollama-local (1)' })
    davis.diagnose.mockResolvedValue({ runtime: { ok: true, detail: '정상' } })
    renderDoctor({ status: 'disconnected' })

    await vi.waitFor(() => expect(davis.reconnectProject).toHaveBeenCalled())

    const labels = [...document.querySelectorAll('.dc-doctor__step-label')].map((n) => n.textContent)
    expect(labels).toEqual(['opencode 서버 확인', '모델 확인', '연결 상태 확인', '재연결'])
  })

  // 서버가 죽어 있으면 재연결해 봐야 같은 자리에서 또 실패한다 — ①을 건너뛰고 ②로 간다
  // 사다리가 어떤 IPC 를 부르는지는 `state/doctorDriver.test.ts` 가 통째로 잠근다.
  // 여기서는 **화면에서 구동해도 그 길로 간다**는 것만 본다.
  it('서버가 죽었으면 재연결 대신 서버부터 되살린다', async () => {
    davis.pingServer.mockResolvedValue({ ok: false, detail: '연결 거부' })
    renderDoctor({ status: 'disconnected' })

    await vi.waitFor(() => expect(davis.controlServer).toHaveBeenCalled())
    // **주인이 누구든 `restart` 다.** 한때 남의 것이면 `start` 를 보냈는데, 세션이 살아
    // 있으면 그것이 무동작 성공이 됐다 (실측 2026-08-16).
    expect(davis.controlServer).toHaveBeenCalledWith({ action: 'restart' })
    // ①을 건너뛰었다. ③은 검산이라 재연결을 부르지 않으므로 한 번도 안 나간다.
    expect(davis.reconnectProject).not.toHaveBeenCalled()
  })
})

// 자동 복구가 이미 사다리를 다 타고 실패해서 창이 열린 경우 — **다시 타지 않는다.**
// 여기서 또 돌면 서버 재시작이 한 번 더 나가고, 그것이 곧 설계가 막으려는 재시작 루프다.
describe('이미 돈 사다리를 받으면 다시 돌지 않는다', () => {
  /** 다 돌고 멈춘 파이프라인 — 모델 실패로 끝낸다 (사다리를 안 타는 유일한 층) */
  function finished() {
    return advance(
      advance(initPipeline(false), { ok: true, detail: '4096 응답' }, false),
      { ok: false, detail: '설정된 모델이 없습니다' },
      false,
    )
  }

  it('initial 을 주면 진단 IPC 를 하나도 부르지 않는다', async () => {
    render(<ConnectionDoctor status="error" initial={finished()} />)

    await vi.waitFor(() => expect(document.querySelector('.dc-doctor__step')).toBeTruthy())
    expect(davis.pingServer).not.toHaveBeenCalled()
    expect(davis.controlServer).not.toHaveBeenCalled()
    expect(davis.reconnectProject).not.toHaveBeenCalled()
  })

  it('「다시 진단」을 누르면 그때 돈다', async () => {
    allGood()
    render(<ConnectionDoctor status="error" initial={finished()} />)

    fireEvent.click(await screen.findByText('다시 진단'))
    await vi.waitFor(() => expect(davis.pingServer).toHaveBeenCalled())
  })
})

describe('수정 폼과의 배선', () => {
  it('폼이 있으면 「다시 진단」 버튼을 따로 두지 않는다 — 연결 시도 하나가 다 한다', async () => {
    allGood()
    renderDoctor()
    await vi.waitFor(() => expect(screen.getByText(/연결이 정상입니다/)).toBeTruthy())

    expect(screen.queryByText('다시 진단')).toBeNull()
    expect(screen.getByText('연결 시도')).toBeTruthy()
  })

  // 프로젝트 없이 연 진단(폼 재료가 없을 때)은 재실행 버튼이 남아야 한다
  it('폼이 없으면 「다시 진단」 버튼이 남는다', async () => {
    allGood()
    render(<ConnectionDoctor status="ready" />)
    await vi.waitFor(() => expect(screen.getByText('다시 진단')).toBeTruthy())
  })

  it('연결 시도를 누르면 진단이 처음부터 다시 돈다', async () => {
    allGood()
    renderDoctor()
    await vi.waitFor(() => expect(screen.getByText(/연결이 정상입니다/)).toBeTruthy())
    const first = davis.pingServer.mock.calls.length

    fireEvent.click(screen.getByText('연결 시도'))
    await vi.waitFor(() => expect(davis.pingServer.mock.calls.length).toBeGreaterThan(first))
  })
})

describe('중지', () => {
  // 재확인이 최대 15초씩 걸린다 — 손을 뗄 수 있어야 한다
  it('도는 동안 중지 버튼이 있고, 누르면 중지했다고 적는다', async () => {
    davis.pingServer.mockImplementation(() => new Promise(() => {}))
    renderDoctor()

    await vi.waitFor(() => expect(screen.getByText('중지')).toBeTruthy())
    fireEvent.click(screen.getByText('중지'))
    expect(screen.getByText('진단을 중지했습니다.')).toBeTruthy()
  })
})
