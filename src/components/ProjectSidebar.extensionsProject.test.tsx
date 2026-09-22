// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectSidebar, type ProjectSidebarProps } from './ProjectSidebar'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import { EMPTY_GIT_STATE } from '../../shared/git/gitState'
import type { ExtensionEntryPayload, ExtensionListPayload } from '../../shared/ipc/extensionPayloads'

// 켜기는 **프로젝트마다**다 (확장 재설계 §3). 사이드바는 앱 수명 목록을 한 번 받고 끝내면
// 안 된다 — 프로젝트를 옮기면 다시 받아야, 앞 프로젝트에서 켠 확장이 이 프로젝트 선택기에
// 남지 않는다. 배선 나머지는 `ProjectSidebar.extensions.test.tsx` 가 본다 (그쪽이 300줄 상한).

const SAMPLE: ExtensionEntryPayload = {
  name: 'sample-ext',
  displayName: '샘플 확장',
  version: '0.1.0',
  dir: '/확장/sample-ext',
  enabled: true,
  contributes: { views: [{ id: 'sampleExt.results', title: '샘플 확장', kind: 'table' }] },
}

/** main 흉내 — 활성 프로젝트 기준으로 켜짐을 답한다. p1 에서만 켜져 있다 */
function stubDavis() {
  const active = { id: 'p1' }
  const listExtensions = vi.fn(
    (): Promise<ExtensionListPayload> =>
      Promise.resolve({
        extensions: [{ ...SAMPLE, enabled: active.id === 'p1' }],
        skipped: [],
        activeProject: { id: active.id, name: active.id },
      }),
  )
  ;(window as unknown as { davis: unknown }).davis = {
    listExtensions,
    onExtensionRows: vi.fn(() => () => {}),
    onExtensionHtml: vi.fn(() => () => {}),
    onExtensionTree: vi.fn(() => () => {}),
    redrawExtensionViews: vi.fn(() => Promise.resolve()),
    onExtensionProgress: vi.fn(() => () => {}),
    cancelExtension: vi.fn(() => Promise.resolve()),
    runExtensionCommand: vi.fn(() => Promise.resolve()),
    requestHistoryList: vi.fn(),
  }
  return { active, listExtensions }
}

const NOOP = {
  status: 'ready' as const,
  tree: { children: { '': [] }, expanded: new Set<string>(), loading: new Set<string>(), toggle: () => {}, refresh: () => {} },
  onPickFile: () => {},
  onTestConnection: () => {},
  onFavorite: () => {},
  git: { state: EMPTY_GIT_STATE, loading: false, toggle: async () => {}, refetch: () => {} },
  onOpenDiff: () => {},
  gitActions: { onRevert: () => {}, onPull: () => {}, onCommit: () => {}, onPush: () => {} },
  history: { entries: [], loading: false, loadingChatId: null, current: null },
  onToast: () => {},
  onOpenFile: () => {},
} as unknown as Omit<ProjectSidebarProps, 'project'>

function project(id: string): ProjectRecord {
  return { id, root: `/tmp/${id}`, name: id, favorite: false, lastOpenedAt: 0 }
}

function options(): (string | null)[] {
  return screen.getAllByRole('option').map((option) => option.textContent)
}

afterEach(cleanup)

describe('프로젝트를 옮기면 확장 목록을 다시 받는다', () => {
  it('p1 에서 켠 확장이 p2 선택기에는 없다', async () => {
    const { active, listExtensions } = stubDavis()
    const view = render(<ProjectSidebar {...NOOP} project={project('p1')} />)
    fireEvent.click(screen.getByRole('button', { name: /프로젝트/ }))
    await waitFor(() => expect(options()).toContain('샘플 확장'))

    // 선택기를 펼칠 때도 받으므로 횟수가 아니라 「옮긴 뒤 더 받았나」를 본다
    const before = listExtensions.mock.calls.length
    active.id = 'p2'
    view.rerender(<ProjectSidebar {...NOOP} project={project('p2')} />)

    await waitFor(() => expect(listExtensions.mock.calls.length).toBeGreaterThan(before))
    if (screen.queryAllByRole('option').length === 0) fireEvent.click(screen.getByRole('button', { name: /프로젝트/ }))
    await waitFor(() => expect(options()).not.toContain('샘플 확장'))
  })
})
