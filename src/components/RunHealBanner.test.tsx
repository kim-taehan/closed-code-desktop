// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDialogs } from './AppDialogs'
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings'
import type { ProjectRecord } from '../../shared/projects/projectRecord'

// **층 사이가 이어졌는가.** `runHeal.test.ts` 는 판정을, `useRunHeal.test.tsx` 는 시간을
// 잠근다 — 둘 다 초록인 채로 **띠가 아무 데도 안 걸려 있을 수 있다.** 그러면 오토힐링은
// 코드로만 존재하고 화면에서는 영영 안 돈다.
//
// 그래서 여기서는 **`AppDialogs` 를 통째로 그린다.** 겨누는 것은 하나: 드로어가 실패를
// 뱉었을 때 예고가 화면에 뜨는가. 사이드바 「실행」 패널에 붙였다면 이 시험이 빨개진다 —
// 그 패널은 사용자가 그 탭을 볼 때만 마운트되기 때문이다 (설계 2026-08-16 §4 는 사용자가
// 어디를 보고 있든 도는 것을 요구한다).

afterEach(cleanup)

type DataHandler = (payload: { name: string; chunk: string }, from: string) => void

const project: ProjectRecord = { id: 'p1', root: '/tmp/p1', name: 'p1', favorite: false, lastOpenedAt: 0 }
const DEV = { name: 'dev 서버', command: 'npm run dev' }

let onData: DataHandler | null = null

beforeEach(() => {
  onData = null
  ;(window as unknown as { davis: unknown }).davis = {
    onExtensionAskText: vi.fn(() => () => {}),
    respondExtensionAskText: vi.fn(),
    readRunList: vi.fn().mockResolvedValue({ found: true, entries: [DEV], stale: false }),
    onRunListChanged: vi.fn(() => () => {}),
    onShellData: vi.fn((handler: DataHandler) => {
      onData = handler
      return () => {}
    }),
    sendShellInput: vi.fn(),
  }
})

/** 연결 진단 쪽은 이 시험의 관심이 아니다 — `status` 를 안 줘 사다리가 안 타게 둔다 */
function mount(): void {
  render(
    <AppDialogs
      palette={null}
      onClosePalette={vi.fn()}
      onOpenFile={vi.fn()}
      settingsOpen={false}
      testingOpen={false}
      project={project}
      theme={{ choice: 'dark', setChoice: vi.fn() }}
      mcp={{} as never}
      mcpOpen={false}
      onCloseMcp={vi.fn()}
      appSettings={{ value: DEFAULT_SETTINGS, save: vi.fn() } as never}
      onCloseSettings={vi.fn()}
      onCloseTesting={vi.fn()}
    />,
  )
}

describe('오토힐링 띠가 앱 수명에 걸려 있다', () => {
  it('드로어 출력을 구독한다 — 팝업이 하나도 안 떠 있어도', () => {
    mount()
    expect(onData).not.toBeNull()
  })

  it('실행 목록의 칸이 아는 실패를 뱉으면 예고가 뜬다', async () => {
    mount()
    // 구독이 걸릴 때까지. **실행 목록을 읽는 왕복에도 이 한 틱이 필요하다** — 목록이
    // 안 들어와 있으면 이 칸이 우리 것인지 모르고 아무 일도 안 일어난다.
    await waitFor(() => expect(onData).not.toBeNull())
    await act(async () => {
      onData?.({ name: DEV.name, chunk: "Error: Cannot find module 'vite'\r\n" }, project.id)
    })
    expect(screen.getByText(/npm install/)).toBeTruthy()
    // 예고를 물릴 손잡이가 함께 있어야 한다 — 없으면 통보일 뿐이다
    expect(screen.getByText('지금은 그만')).toBeTruthy()
  })
})
