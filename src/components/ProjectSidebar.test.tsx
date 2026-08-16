// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectSidebar } from './ProjectSidebar'
import type { ProjectRecord } from '../../shared/projects/projectRecord'

// 사이드바 맨 아래 상태 버튼의 **목적지**를 잠근다.
//
// 설정이 비어 있을 때 이 버튼이 설정 창을 열면 사용자가 갇힌다 —
// 연결에 필요한 값(주소·키)을 넣는 자리는 "프로젝트 연결" 팝업뿐이고,
// 설정 창에는 연결 항목이 없다 (가이드 검토에서 드러난 실제 결함).

const project: ProjectRecord = {
  id: 'p1',
  root: '/tmp/p1',
  name: 'p1',
  favorite: false,
  lastOpenedAt: 0,
}

// 사이드바가 확장 패널을 쥐면서 마운트 즉시 window.davis 를 부른다 — jsdom 엔 없으므로 세워 둔다
;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
;(window as unknown as { davis: unknown }).davis = {
  listExtensions: () => Promise.resolve({ extensions: [], skipped: [] }),
  onExtensionRows: () => () => {},
  onExtensionHtml: () => () => {},
  onExtensionTree: () => () => {},
  redrawExtensionViews: () => Promise.resolve(),
  onExtensionProgress: () => () => {},
  cancelExtension: () => Promise.resolve(),
  requestHistoryList: () => {},
}

function renderSidebar(overrides: Partial<Parameters<typeof ProjectSidebar>[0]> = {}) {
  const onTestConnection = vi.fn()
  render(
    <ProjectSidebar
      project={project}
      status="ready"
      tree={{ children: { '': [] }, expanded: new Set(), loading: new Set(), toggle: vi.fn() }}
      onPickFile={vi.fn()}
      onOpenFile={vi.fn()}
      onOpenHtml={vi.fn()}
      onTestConnection={onTestConnection}
      onFavorite={vi.fn()}
      git={{ state: { branch: null, staged: [], unstaged: [], untracked: [] }, loading: false } as never}
      onOpenDiff={vi.fn()}
      gitActions={{} as never}
      history={{ entries: [], loading: false } as never}
      // 「실행」 패널은 이 시험이 안 그린다 — 기본 패널은 프로젝트다
      shell={{} as never}
      onToast={vi.fn()}
      {...overrides}
    />,
  )
  return { onTestConnection }
}

afterEach(cleanup)

describe('사이드바 상태 버튼', () => {
  it('설정이 비어 있으면 사유를 보여주고, 눌렀을 때 연결 팝업으로 간다', () => {
    const { onTestConnection } = renderSidebar({ setupReason: '라이선스 키 가 없습니다' })

    fireEvent.click(screen.getByText('설정이 필요합니다'))

    expect(onTestConnection).toHaveBeenCalledTimes(1)
  })

  it('설정이 갖춰져 있으면 세션 상태를 보여주고, 눌렀을 때도 연결 팝업으로 간다', () => {
    const { onTestConnection } = renderSidebar()

    fireEvent.click(screen.getByText('준비됨'))

    expect(onTestConnection).toHaveBeenCalledTimes(1)
  })
})

// 브랜치 메뉴는 App 이 만들어(`useAppGit`) 여기를 지나 `GitPanel` 로 간다.
// 이 통로가 끊긴 채로 3단계가 끝났고 아무도 몰랐다 (QA D6) — 통로를 잠근다.
describe('사이드바 소스 관리 갈래', () => {
  function openGitPanel() {
    fireEvent.click(screen.getByRole('button', { name: '프로젝트' }))
    fireEvent.click(screen.getByRole('option', { name: '소스 관리' }))
  }

  const gitState = { state: { isRepo: true, branch: 'main', staged: [], unstaged: [] }, loading: false }

  it('브랜치 메뉴를 칩까지 흘려보낸다', () => {
    const onSwitch = vi.fn()
    renderSidebar({
      git: gitState as never,
      branchMenu: {
        branches: [
          { name: 'main', remote: false, date: '', track: '', current: true },
          { name: 'feat/x', remote: false, date: '', track: '', current: false },
        ],
        busy: false,
        onSwitch,
        onCreate: vi.fn(),
      },
    })

    openGitPanel()
    fireEvent.click(screen.getByRole('button', { name: /main/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'feat/x' }))

    expect(onSwitch).toHaveBeenCalledWith('feat/x')
  })

  it('메뉴를 안 받으면 칩에 누를 것이 없다', () => {
    renderSidebar({ git: gitState as never })

    openGitPanel()

    expect(screen.queryByText('▾')).toBeNull()
  })
})
