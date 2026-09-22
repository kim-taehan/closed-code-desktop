// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectSidebar, type ProjectSidebarProps } from './ProjectSidebar'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import { EMPTY_GIT_STATE } from '../../shared/git/gitState'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'
import type { ExtensionUiTarget } from '../../shared/ipc/extensionUiBridge'

// 사이드바 웹뷰 (하이닉스 H2 결정 K-1) — 선택기에서 고르면 그 확장의 `ui/` 가 사이드바 칸에 뜨고,
// **다른 패널로 갔다 와도 다시 뜨지 않는다** (같은 iframe 이 CSS 로만 감춰진다).
//
// 앞단 ↔ 뒷단 행선지는 `electron/extensions/sidebarWebview.test.ts` 가 진짜 자식으로 본다. 여기는 화면 쪽이다.

const SIDEBAR_EXT: ExtensionEntryPayload = {
  name: 'sidebar-fixture',
  displayName: '결재함 확장',
  version: '0.0.1',
  dir: '/확장/sidebar-fixture',
  enabled: true,
  contributes: {
    views: [
      { id: 'list', title: '결재함', kind: 'webview', entry: 'ui/list.html', location: 'sidebar' },
      { id: 'detail', title: '일감', kind: 'webview', entry: 'ui/detail.html' },
    ],
  },
}

function stubDavis(extensions: ExtensionEntryPayload[]) {
  let next = 0
  const stub = {
    listExtensions: vi.fn(() => Promise.resolve({ extensions, skipped: [] })),
    onExtensionRows: vi.fn(() => () => {}),
    onExtensionHtml: vi.fn(() => () => {}),
    onExtensionTree: vi.fn(() => () => {}),
    redrawExtensionViews: vi.fn(() => Promise.resolve()),
    onExtensionProgress: vi.fn(() => () => {}),
    cancelExtension: vi.fn(() => Promise.resolve()),
    runExtensionCommand: vi.fn(() => Promise.resolve()),
    requestHistoryList: vi.fn(),
    // 웹뷰 런타임 — 토큰은 띄울 때마다 새로 나온다 (새로 나오면 문서가 다시 뜬 것이다)
    openExtensionUi: vi.fn(async (_target: ExtensionUiTarget) => {
      next += 1
      return { ok: true as const, token: `t${next}`, url: `code-ext://ui/t${next}/list.html`, title: '결재함' }
    }),
    closeExtensionUi: vi.fn(async () => {}),
    sendExtensionUi: vi.fn(async () => {}),
    onExtensionUiMessage: vi.fn(() => () => {}),
  }
  ;(window as unknown as { davis: unknown }).davis = stub
  return stub
}

const project = (id: string): ProjectRecord => ({ id, root: `/tmp/${id}`, name: id, favorite: false, lastOpenedAt: 0 })

const NOOP = {
  status: 'ready' as const,
  tree: { children: { '': [] }, expanded: new Set<string>(), loading: new Set<string>(), toggle: () => {}, refresh: () => {} },
  onPickFile: () => {},
  onOpenFile: () => {},
  onTestConnection: () => {},
  onFavorite: () => {},
  git: { state: EMPTY_GIT_STATE, loading: false, toggle: async () => {}, refetch: () => {} },
  onOpenDiff: () => {},
  gitActions: { onRevert: () => {}, onPull: () => {}, onCommit: () => {}, onPush: () => {} },
  history: { entries: [], loading: false, loadingChatId: null, current: null },
  onToast: () => {},
} as unknown as Omit<ProjectSidebarProps, 'project'>

/** 선택기를 펼쳐 고른다. 토글 버튼의 이름은 지금 패널이라 `current` 로 찾는다 */
async function pick(current: RegExp, option: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: current }))
  await waitFor(() => screen.getByRole('option', { name: option }))
  fireEvent.click(screen.getByRole('option', { name: option }))
  await act(async () => {})
}

const frames = () => [...document.querySelectorAll('.dc-sidebar__body iframe')] as HTMLIFrameElement[]

afterEach(cleanup)

describe('사이드바 웹뷰', () => {
  it('선택기에 나오고, 고르면 그 확장의 사이드바 뷰를 이 프로젝트로 띄운다 (고르기 전에는 안 띄운다)', async () => {
    const davis = stubDavis([SIDEBAR_EXT])
    render(<ProjectSidebar {...NOOP} project={project('p1')} />)
    await act(async () => {})
    expect(davis.openExtensionUi).not.toHaveBeenCalled()

    await pick(/프로젝트/, '결재함 확장')

    expect(davis.openExtensionUi).toHaveBeenCalledTimes(1)
    expect(davis.openExtensionUi).toHaveBeenCalledWith({ extension: 'sidebar-fixture', viewId: 'list', projectId: 'p1' })
    expect(frames()).toHaveLength(1)
    expect(frames()[0]!.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('**다른 패널로 갔다 와도 다시 뜨지 않는다** — 같은 iframe 이 감춰졌다 다시 보인다', async () => {
    const davis = stubDavis([SIDEBAR_EXT])
    render(<ProjectSidebar {...NOOP} project={project('p1')} />)
    await pick(/프로젝트/, '결재함 확장')
    const frame = frames()[0]!

    await pick(/결재함 확장/, '프로젝트')
    expect(frame.isConnected).toBe(true)
    expect(frame.closest('.ext-webview')!.classList.contains('ext-webview--hidden')).toBe(true)

    await pick(/프로젝트/, '결재함 확장')
    expect(frames()).toEqual([frame])
    expect(frame.closest('.ext-webview')!.classList.contains('ext-webview--hidden')).toBe(false)
    expect(davis.openExtensionUi).toHaveBeenCalledTimes(1)
    expect(davis.closeExtensionUi).not.toHaveBeenCalled()
  })

  it('이 프로젝트에서 꺼진 확장은 선택기에도 사이드바에도 없다', async () => {
    const davis = stubDavis([{ ...SIDEBAR_EXT, enabled: false }])
    render(<ProjectSidebar {...NOOP} project={project('p1')} />)
    fireEvent.click(screen.getByRole('button', { name: /프로젝트/ }))
    await act(async () => {})

    expect(screen.queryByRole('option', { name: '결재함 확장' })).toBeNull()
    expect(frames()).toEqual([])
    expect(davis.openExtensionUi).not.toHaveBeenCalled()
  })

  it('프로젝트를 옮기면 앞 프로젝트의 것을 놓고, 그 프로젝트에서 고를 때 그 프로젝트로 새로 띄운다', async () => {
    const davis = stubDavis([SIDEBAR_EXT])
    const view = render(<ProjectSidebar {...NOOP} project={project('p1')} />)
    await pick(/프로젝트/, '결재함 확장')

    view.rerender(<ProjectSidebar {...NOOP} project={project('p2')} />)
    await act(async () => {})
    // p2 는 아무것도 고른 적 없다 — 프로젝트 패널이고, p1 의 iframe 은 내려졌다
    expect(frames()).toEqual([])
    expect(davis.closeExtensionUi).toHaveBeenCalledWith({ token: 't1' })

    await pick(/프로젝트/, '결재함 확장')
    expect(davis.openExtensionUi).toHaveBeenLastCalledWith({ extension: 'sidebar-fixture', viewId: 'list', projectId: 'p2' })

    // 둘 다 이 확장을 보던 프로젝트끼리 옮겨도 **새 iframe** 이다 — 같은 요소를 물려받으면 앞 토큰을 쥔 채
    // 새 토큰의 첫 메시지를 버리는 탭이 된다 (`ExtensionWebview` 의 토큰 전 버퍼는 마운트 때 한 번만 선다)
    const inP2 = frames()[0]!
    view.rerender(<ProjectSidebar {...NOOP} project={project('p1')} />)
    await act(async () => {})
    expect(frames()).toHaveLength(1)
    expect(frames()[0]).not.toBe(inP2)
    expect(davis.openExtensionUi).toHaveBeenLastCalledWith({ extension: 'sidebar-fixture', viewId: 'list', projectId: 'p1' })
  })
})
