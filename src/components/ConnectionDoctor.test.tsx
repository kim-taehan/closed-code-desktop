// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionDoctor } from './ConnectionDoctor'
import { DEFAULT_OPENCODE_URL, DEFAULT_SETTINGS } from '../../shared/settings/appSettings'

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
}

/** 셋 다 통과하는 평범한 성공 */
function allGood() {
  davis.pingServer.mockResolvedValue({ ok: true, detail: '4096 응답' })
  davis.checkModels.mockResolvedValue({ ok: true, message: 'ollama-local (1)' })
  davis.diagnose.mockResolvedValue({ runtime: { ok: true, detail: '정상' } })
}

beforeEach(() => {
  for (const fn of Object.values(davis)) fn.mockReset()
  davis.reconnectProject.mockResolvedValue(undefined)
  ;(window as unknown as { davis: unknown }).davis = davis
})

function renderDoctor(props: Partial<Parameters<typeof ConnectionDoctor>[0]> = {}) {
  const onHealthy = vi.fn()
  const onSaveSettings = vi.fn().mockResolvedValue(undefined)
  render(
    <ConnectionDoctor
      status="ready"
      onHealthy={onHealthy}
      fix={{
        settings: { ...DEFAULT_SETTINGS, opencodeUrl: DEFAULT_OPENCODE_URL },
        onSaveSettings,
      }}
      {...props}
    />,
  )
  return { onHealthy, onSaveSettings }
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
  it('서버가 죽으면 ✗ 하나에 – 둘이고, 뒤 단계는 부르지 않는다', async () => {
    davis.pingServer.mockResolvedValue({ ok: false, detail: '연결 거부' })
    renderDoctor()

    await vi.waitFor(() => expect(marks()).toEqual(['✗', '–', '–']))
    // 서버가 죽었으면 모델·세션은 볼 것이 없다
    expect(davis.checkModels).not.toHaveBeenCalled()
    expect(davis.diagnose).not.toHaveBeenCalled()
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
  it('사유가 단계 줄과 이슈 목록 양쪽에 나오고, 이슈에는 다음 행동이 붙는다', async () => {
    davis.pingServer.mockResolvedValue({ ok: false, detail: '연결 거부' })
    renderDoctor()

    await vi.waitFor(() => expect(document.querySelector('.dc-doctor__item')).toBeTruthy())

    expect(document.querySelector('.dc-doctor__step-detail')?.textContent).toBe('연결 거부')
    expect(document.querySelector('.dc-doctor__cause')?.textContent).toBe('연결 거부')
    expect(document.querySelector('.dc-doctor__advice')?.textContent).toContain('opencode serve')
  })

  // 모델 실패는 서버 실패와 다르다 — 서버는 ✓ 로 남고 세션만 – 다
  it('모델이 없으면 ✓ ✗ – 이고 세션은 부르지 않는다', async () => {
    davis.pingServer.mockResolvedValue({ ok: true, detail: '4096 응답' })
    davis.checkModels.mockResolvedValue({ ok: false, message: '설정된 모델이 없습니다' })
    renderDoctor()

    await vi.waitFor(() => expect(marks()).toEqual(['✓', '✗', '–']))
    expect(davis.diagnose).not.toHaveBeenCalled()
  })

  it('실패로 끝나면 onHealthy 를 부르지 않는다', async () => {
    davis.pingServer.mockResolvedValue({ ok: false, detail: '연결 거부' })
    const { onHealthy } = renderDoctor()

    await vi.waitFor(() => expect(marks()[0]).toBe('✗'))
    expect(onHealthy).not.toHaveBeenCalled()
  })
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

  // 서버가 죽어 있으면 재연결해 봐야 같은 자리에서 또 실패한다
  it('서버가 죽었으면 재연결을 시도하지 않는다', async () => {
    davis.pingServer.mockResolvedValue({ ok: false, detail: '연결 거부' })
    renderDoctor({ status: 'disconnected' })

    await vi.waitFor(() => expect(marks()[0]).toBe('✗'))
    expect(davis.reconnectProject).not.toHaveBeenCalled()
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
