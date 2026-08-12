// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDialogs } from './AppDialogs'
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import type { ProjectStatus } from '../state/projectStatus'

// 진단 팝업이 **언제 뜨고 무엇을 들고 뜨는가.**
//
// 지금 이 팝업에 닿는 길은 하나뿐이다 — 사이드바 상태 배지 클릭(`App.tsx`)이 `testingOpen`
// 을 올린다. **자동으로 뜨는 길은 없다** (D3 가 그것을 더한다).
// 이 파일은 **D3 가 손대기 전의 현 동작**을 잠근다 — 그래야 D3 가 더한 것이 무엇인지 갈린다.

afterEach(cleanup)

const project: ProjectRecord = { id: 'p1', root: '/tmp/p1', name: 'p1', favorite: false, lastOpenedAt: 0 }

beforeEach(() => {
  ;(window as unknown as { davis: unknown }).davis = {
    // 팝업이 열리면 곧바로 진단이 돈다 — 여기서 보는 것은 배선이라 첫 단계에서 멈춰 세운다
    pingServer: vi.fn(() => new Promise(() => {})),
    checkModels: vi.fn(),
    diagnose: vi.fn(),
    reconnectProject: vi.fn(),
    // AppDialogs 는 확장 물음창(`useAskText`)도 쥔다 — 마운트 즉시 구독한다
    onExtensionAskText: vi.fn(() => () => {}),
    respondExtensionAskText: vi.fn(),
  }
})

function setup(over: { testingOpen?: boolean; status?: ProjectStatus; project?: ProjectRecord | null } = {}) {
  const appSettings = { value: DEFAULT_SETTINGS, save: vi.fn().mockResolvedValue(undefined) }
  const chosen = over.project === undefined ? project : over.project

  render(
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
      onCloseTesting={vi.fn()}
    />,
  )
  return { appSettings }
}

describe('진단 팝업이 뜨는 조건', () => {
  it('testingOpen 이고 status 가 있으면 뜬다', () => {
    setup()
    expect(screen.getByRole('dialog', { name: '프로젝트 연결' })).toBeTruthy()
  })

  it('testingOpen 이 아니면 안 뜬다', () => {
    setup({ testingOpen: false })
    expect(screen.queryByRole('dialog', { name: '프로젝트 연결' })).toBeNull()
  })

  // status 가 없다는 것은 아직 그릴 상태가 없다는 뜻이다 — 열면 첫 렌더에 빈 진단이 뜬다.
  // **D3 가 자동 게이트를 붙일 때 이 조건을 반드시 다시 봐야 한다** (계획서 미확정 1).
  it('status 가 없으면 안 뜬다', () => {
    setup({ status: null as never })
    expect(screen.queryByRole('dialog', { name: '프로젝트 연결' })).toBeNull()
  })
})

describe('무엇을 들고 뜨는가', () => {
  it('프로젝트가 있으면 경로와 수정 폼을 함께 준다', () => {
    setup()
    expect(screen.getByText('/tmp/p1')).toBeTruthy()
    // 수정 폼이 있으면 주소 칸이 나온다 — 왕복 없이 이 자리에서 고친다
    expect(screen.getByLabelText('opencode 서버')).toBeTruthy()
  })

  // 프로젝트 없이 연 진단 — 고칠 대상이 없으니 폼도 없다
  it('프로젝트가 없으면 폼 없이 진단만 준다', () => {
    setup({ project: null })
    expect(screen.getByRole('dialog', { name: '프로젝트 연결' })).toBeTruthy()
    expect(screen.queryByLabelText('opencode 서버')).toBeNull()
  })
})
