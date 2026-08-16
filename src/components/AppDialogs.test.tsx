// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDialogs } from './AppDialogs'
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import type { ProjectStatus } from '../state/projectStatus'

// 진단 팝업이 **언제 뜨고 무엇을 들고 뜨는가.**
//
// **닿는 길이 둘이 됐다** (D3): 사이드바 상태 배지 클릭(`App.tsx` → `testingOpen`)과
// **자동 게이트**(`useDoctorGate`).
//
// D1 이 이 파일로 **D3 이전의 현 동작**을 잠가 뒀고, D3 에서 **한 케이스가 실제로 빨개졌다**:
// *"testingOpen 이 아니면 안 뜬다"* — 그 케이스가 쓰던 기본 상태가 `error` 라 이제 자동으로
// 뜬다. 그것이 D3 이 더한 것의 전부이고, 케이스는 **의도를 지킨 채** 아래처럼 갈렸다:
// 「배지를 안 눌렀고 **게이트도 안 걸리는 상태**면 안 뜬다」.
//
// ⚠️ **게이트의 조건이 한 번 더 바뀌었다** (설계 2026-08-16). *"연결에 실패한 프로젝트를
// 열면 스스로 뜬다"* 였는데, 이제 앱이 먼저 **사다리를 한 바퀴 탄다** — 재연결 → 서버
// 되살리기 → 재연결. 창은 그게 다 실패했을 때만 뜬다 (2단 승격의 마지막 칸). 그래서
// 아래 케이스들은 전부 **기다린다**: `error` 가 된 순간이 아니라 사다리가 끝난 순간이다.

afterEach(cleanup)

const project: ProjectRecord = { id: 'p1', root: '/tmp/p1', name: 'p1', favorite: false, lastOpenedAt: 0 }

beforeEach(() => {
  ;(window as unknown as { davis: unknown }).davis = {
    // 팝업이 열리면 곧바로 진단이 돈다 — 여기서 보는 것은 배선이라 첫 단계에서 멈춰 세운다
    pingServer: vi.fn(() => new Promise(() => {})),
    checkModels: vi.fn(),
    diagnose: vi.fn(),
    reconnectProject: vi.fn(),
    serverStatus: vi.fn().mockResolvedValue({ running: false, url: null, pid: null, ours: false }),
    controlServer: vi.fn(),
    // AppDialogs 는 확장 물음창(`useAskText`)도 쥔다 — 마운트 즉시 구독한다
    onExtensionAskText: vi.fn(() => () => {}),
    respondExtensionAskText: vi.fn(),
    // 오토힐링 띠(`RunHealBanner`)도 여기 산다 — 사이드바 「실행」 패널은 그 패널을 볼 때만
    // 마운트되는데 오토힐링은 사용자가 어디를 보고 있든 돌아야 한다 (설계 2026-08-16 §4).
    // 그래서 실행 목록과 드로어 출력 구독이 이 창들의 마운트에 함께 걸린다.
    readRunList: vi.fn().mockResolvedValue({ found: false, entries: [], stale: false }),
    onRunListChanged: vi.fn(() => () => {}),
    onShellData: vi.fn(() => () => {}),
    sendShellInput: vi.fn(),
  }
})

/**
 * 자가 복구 사다리가 **폴링 없이 곧장 실패하게** 만든다.
 *
 * 서버 ping 실패 → ②(갈아타기) → 서버도 못 뜸 → `manual`. 재연결 재확인(1초 × 3)이
 * 한 번도 안 끼는 유일한 길이라, 게이트 시험이 초 단위로 늘어지지 않는다.
 */
function ladderFailsFast() {
  const davis = (window as unknown as { davis: Record<string, unknown> }).davis
  davis['pingServer'] = vi.fn().mockResolvedValue({ ok: false, detail: '연결 거부' })
  davis['controlServer'] = vi.fn().mockResolvedValue({
    ok: false,
    error: 'opencode 실행 파일을 찾지 못했습니다',
    status: { running: false, url: null, pid: null, ours: false },
  })
}

interface Over {
  testingOpen?: boolean
  status?: ProjectStatus
  project?: ProjectRecord | null
  onCloseTesting?: () => void
}

const appSettings = { value: DEFAULT_SETTINGS, save: vi.fn().mockResolvedValue(undefined) }

function dialogs(over: Over) {
  const chosen = over.project === undefined ? project : over.project
  return (
    <AppDialogs
      palette={null}
      onClosePalette={vi.fn()}
      onOpenFile={vi.fn()}
      settingsOpen={false}
      testingOpen={over.testingOpen ?? true}
      {...(chosen ? { project: chosen } : {})}
      theme={{ choice: 'dark', setChoice: vi.fn() }}
      mcp={{} as never}
      mcpOpen={false}
      onCloseMcp={vi.fn()}
      appSettings={appSettings as never}
      {...(over.status === null ? {} : { status: over.status ?? 'error' })}
      onCloseSettings={vi.fn()}
      onCloseTesting={over.onCloseTesting ?? vi.fn()}
    />
  )
}

function setup(over: Over = {}) {
  const view = render(dialogs(over))
  // 게이트는 프로젝트·상태가 **바뀌는 것**을 보고 판정한다 — 다시 그릴 수 있어야 시험된다
  return { appSettings, again: (next: Over) => view.rerender(dialogs(next)) }
}

function popup(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: '프로젝트 연결' })
}

describe('진단 팝업이 뜨는 조건', () => {
  it('testingOpen 이고 status 가 있으면 뜬다', () => {
    setup()
    expect(screen.getByRole('dialog', { name: '프로젝트 연결' })).toBeTruthy()
  })

  // D1 때는 `status` 를 안 줘도 `error` 가 기본이라 이 케이스가 통과했다. D3 부터 `error` 는
  // **게이트가 스스로 여는 상태**라, 「배지를 안 눌렀다」만으로는 안 닫힌다 — 상태도 눌러야 한다.
  it('배지를 안 눌렀고 게이트도 안 걸리는 상태면 안 뜬다', () => {
    setup({ testingOpen: false, status: 'idle' })
    expect(screen.queryByRole('dialog', { name: '프로젝트 연결' })).toBeNull()
  })

  // status 가 없다는 것은 아직 그릴 상태가 없다는 뜻이다 — 열면 첫 렌더에 빈 진단이 뜬다.
  // 게이트도 `status` 를 보고 판정하므로 여기서는 어느 쪽 길로도 안 뜬다 (계획서 미확정 1).
  it('status 가 없으면 안 뜬다', () => {
    setup({ status: null as never })
    expect(screen.queryByRole('dialog', { name: '프로젝트 연결' })).toBeNull()
  })
})

describe('무엇을 들고 뜨는가', () => {
  // 왼쪽 열의 이름이 「연결 설정」에서 「연결」로 바뀌었다 — 고칠 값이 없어졌기 때문이다
  // (`ConnectionFixForm` 머리말). 열 자체는 프로젝트가 있을 때만 뜬다.
  // 버튼 글자로 찾지 않는다 — 진단이 도는 동안에는 「진단 중…」이라 상태에 따라 갈린다
  it('프로젝트가 있으면 경로와 연결 열을 함께 준다', () => {
    setup()
    expect(screen.getByText('/tmp/p1')).toBeTruthy()
    expect(document.querySelector('.dc-settings__apply')).toBeTruthy()
  })

  // 프로젝트 없이 연 진단 — 서버가 프로젝트마다 하나라 보여 줄 주소도 없다
  it('프로젝트가 없으면 연결 열 없이 진단만 준다', () => {
    setup({ project: null })
    expect(screen.getByRole('dialog', { name: '프로젝트 연결' })).toBeTruthy()
    expect(document.querySelector('.dc-settings__apply')).toBeNull()
  })
})

// **여기가 D3 의 본체다.** 지금까지 진단에 닿는 길은 사이드바 배지 클릭 하나뿐이었다.
// davis 는 첫 열기에 설정이 비면 팝업을 띄웠고, 그 주석이 이유를 적었다 —
// *"빈 화면 앞에서 왜 안 되는지 찾게 두지 않는다."*
//
// opencode 에서는 그 상태가 **더 흔하다.** 사용자가 `opencode serve` 를 먼저 쳐야 하기
// 때문이다. davis 는 앱이 런타임을 띄웠으니 "안 떠 있는 첫 실행" 이 예외였지만,
// opencode 에서는 **그게 기본값이다.**
describe('자동 게이트 — 자가 복구가 다 실패하면 스스로 뜬다', () => {
  // **`error` 가 된 순간이 아니다.** 사다리를 한 바퀴 태우고 그것이 실패해야 뜬다 —
  // 가볍게 복구될 것에도 창이 뜨면 2단 승격이 아무 뜻이 없다 (설계 §3).
  it('error 에서 사다리가 다 실패하면 배지를 안 눌러도 뜬다', async () => {
    ladderFailsFast()
    setup({ testingOpen: false, status: 'error' })
    expect(popup()).toBeNull()
    await waitFor(() => expect(popup()).toBeTruthy())
  })

  // ⭐ 사다리가 **살려내면** 창은 끝까지 안 뜬다 — 사용자는 모르고 지나간다
  it('사다리가 성공하면 창이 안 뜬다', async () => {
    const davis = (window as unknown as { davis: Record<string, unknown> }).davis
    davis['pingServer'] = vi.fn().mockResolvedValue({ ok: true, detail: '4096 응답' })
    davis['checkModels'] = vi.fn().mockResolvedValue({ ok: true, message: 'ollama-local (1)' })
    davis['diagnose'] = vi.fn().mockResolvedValue({ endpoint: null, runtime: { ok: true, detail: '정상' } })
    // 상태가 ready 라 첫 진단에서 healthy 로 끝난다
    setup({ testingOpen: false, status: 'ready' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    expect(popup()).toBeNull()
  })

  // ⭐ **이것이 D3 의 본체 케이스다.** `idle` 은 **아직 시도조차 안 한 상태**다
  // (세션이 없다 — 지연 연결의 기본). 여기서 열면 **첫 렌더마다 팝업이 뜬다.**
  it('idle 에서는 안 뜬다 — 아직 붙어 보지도 않았다', () => {
    setup({ testingOpen: false, status: 'idle' })
    expect(popup()).toBeNull()
  })

  // 재연결 로직이 도는 중이다. 중간에 튀어나오는 팝업은 방해다.
  // **사다리가 끝나면 뜬다** — 「도는 중에는 안 뜬다」가 이 케이스의 뜻이고 그건 그대로다.
  it('disconnected 에서는 곧바로 안 뜬다 — 재연결이 도는 중이다', () => {
    ladderFailsFast()
    setup({ testingOpen: false, status: 'disconnected' })
    expect(popup()).toBeNull()
  })

  it('정상 상태에서는 당연히 안 뜬다', () => {
    setup({ testingOpen: false, status: 'ready' })
    expect(popup()).toBeNull()
  })

  // 프로젝트를 활성화하면 지연 연결이 곧바로 도니, 서버가 없으면 1~2초 안에 error 가 된다
  it('idle 로 시작해 error 가 되면 그때 사다리를 탄다', async () => {
    ladderFailsFast()
    const { again } = setup({ testingOpen: false, status: 'idle' })
    expect(popup()).toBeNull()
    again({ testingOpen: false, status: 'error' })
    await waitFor(() => expect(popup()).toBeTruthy())
  })
})

describe('자동 게이트 — 한 번만, 그리고 스스로 닫힌다', () => {
  // 매번 뜨면 서버를 일부러 안 띄운 사용자에게 방해다. 방해가 되면 그 화면을 아예 안 보게 되고,
  // 정작 필요할 때 못 쓴다 — 게이트를 붙이는 목적 자체가 무너진다.
  it('닫으면 같은 프로젝트에서 다시 안 뜬다', async () => {
    ladderFailsFast()
    const { again } = setup({ testingOpen: false, status: 'error' })
    await waitFor(() => expect(popup()).toBeTruthy())
    fireEvent.click(screen.getByTitle('닫기'))
    expect(popup()).toBeNull()

    again({ testingOpen: false, status: 'ready' })
    again({ testingOpen: false, status: 'error' })
    expect(popup()).toBeNull()
  })

  // ⚠️ 치유가 도는 동안 상태는 error → connecting → error 로 오갈 수 있다. 그때 닫아 버리면
  // 이미 "한 번 열었다" 로 표시돼 **다시 안 열린다.** 닫는 것은 사용자와 진단 성공뿐이다.
  it('상태가 error 를 벗어났다고 저절로 닫히지는 않는다', async () => {
    ladderFailsFast()
    const { again } = setup({ testingOpen: false, status: 'error' })
    await waitFor(() => expect(popup()).toBeTruthy())
    again({ testingOpen: false, status: 'connecting' })
    expect(popup()).toBeTruthy()
  })

  // A 를 진단하다 B 로 옮겼는데 A 의 팝업이 B 위에 남으면 어느 프로젝트 것인지 알 수 없다
  it('프로젝트를 바꾸면 닫힌다', async () => {
    const other: ProjectRecord = { id: 'p2', root: '/tmp/p2', name: 'p2', favorite: false, lastOpenedAt: 0 }
    ladderFailsFast()
    const { again } = setup({ testingOpen: false, status: 'error' })
    await waitFor(() => expect(popup()).toBeTruthy())

    again({ testingOpen: false, status: 'ready', project: other })
    expect(popup()).toBeNull()
  })

  // 프로젝트마다 따로 센다 — A 를 닫았다고 B 가 조용해지면 안 된다
  it('다른 프로젝트에서는 다시 뜬다', async () => {
    const other: ProjectRecord = { id: 'p2', root: '/tmp/p2', name: 'p2', favorite: false, lastOpenedAt: 0 }
    ladderFailsFast()
    const { again } = setup({ testingOpen: false, status: 'error' })
    await waitFor(() => expect(popup()).toBeTruthy())
    fireEvent.click(screen.getByTitle('닫기'))

    again({ testingOpen: false, status: 'error', project: other })
    await waitFor(() => expect(popup()).toBeTruthy())
  })
})

describe('두 길이 한 팝업이다', () => {
  // 배지로 연 것은 App 이 `testingOpen` 을 쥔다 — 게이트가 닫아도 그쪽은 안 내려간다.
  // 그래서 닫는 손짓 하나가 **둘 다** 내려야 한 번에 닫힌다.
  it('닫으면 게이트와 App 쪽을 함께 내린다', () => {
    const onCloseTesting = vi.fn()
    setup({ testingOpen: true, status: 'error', onCloseTesting })
    fireEvent.click(screen.getByTitle('닫기'))
    expect(onCloseTesting).toHaveBeenCalled()
  })

  // 배지로 연 팝업은 게이트가 닫아도 남는다 — 그것을 내리는 것은 App 의 몫이다
  it('배지로 연 것은 게이트와 무관하게 떠 있다', () => {
    setup({ testingOpen: true, status: 'ready' })
    expect(popup()).toBeTruthy()
  })
})

// 계획서가 이 자리를 미리 가리켜 뒀다 — `onHealthy` 는 *"최초 등록 게이트의 자동 닫힘용"*
// 이라고 `ConnectionDoctor.tsx:40` 이 적고 있었는데 **부르는 주인이 없었다.** D3 이 돌려준다.
//
// ⚠️ **닫히는 길이 하나 좁아졌다.** 게이트가 연 창은 이제 **이미 돈 사다리를 그리기만
// 한다**(`initial`) — 열자마자 스스로 진단하지 않는다. 그러면 자동으로 서버 재시작이
// 한 번 더 나가고, 그것이 설계가 막으려는 재시작 루프다 (§2). 그래서 초록으로 끝나는
// 순간은 **사용자가 「연결 시도」를 누른 뒤**이고, 그때 이 배선이 그대로 도는지를 본다.
describe('자동 게이트 — 진단이 초록으로 끝나면 스스로 닫힌다', () => {
  it('사용자가 서버를 띄우고 다시 재면 팝업이 사라진다', async () => {
    ladderFailsFast()
    const { again } = setup({ testingOpen: false, status: 'error' })
    await waitFor(() => expect(popup()).toBeTruthy())

    // 사용자가 서버를 띄웠다 → 지연 연결이 붙어 ready 가 된다
    const davis = (window as unknown as { davis: Record<string, unknown> }).davis
    davis['pingServer'] = vi.fn().mockResolvedValue({ ok: true, detail: '127.0.0.1:4096 응답' })
    davis['checkModels'] = vi.fn().mockResolvedValue({ ok: true, message: 'ollama-local (1)' })
    davis['diagnose'] = vi.fn().mockResolvedValue({ endpoint: null, runtime: { ok: true, detail: '응답' } })
    again({ testingOpen: false, status: 'ready' })

    await act(async () => {
      fireEvent.click(screen.getByText('연결 시도'))
    })
    await waitFor(() => expect(popup()).toBeNull())
  })
})
