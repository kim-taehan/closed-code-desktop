// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectSidebar } from './ProjectSidebar'
import { ProjectEmptyState } from './ProjectEmptyState'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import { EMPTY_GIT_STATE } from '../../shared/git/gitState'

// 사이드바·런처. `ProjectRail.test.tsx` 에서 갈라 나왔다 (300줄 상한) —
// 한 파일이 세 컴포넌트를 보고 있었고, 레일이 커지면서 상한에 닿았다.

// 사이드바가 이력·확장 조작에 window.davis 를 직접 부른다 — jsdom 엔 없으므로 세워 둔다
const davisStub = {
  requestHistoryList: vi.fn(),
  resetChat: vi.fn(),
  loadHistory: vi.fn(),
  removeHistory: vi.fn(),
  // 확장 패널이 마운트되자마자 부른다 (`useExtensionPanel`)
  listExtensions: vi.fn(() => Promise.resolve({ extensions: [], skipped: [] })),
  onExtensionRows: vi.fn(() => () => {}),
  onExtensionHtml: vi.fn(() => () => {}),
  onExtensionTree: vi.fn(() => () => {}),
  redrawExtensionViews: vi.fn(() => Promise.resolve()),
  onExtensionProgress: vi.fn(() => () => {}),
  cancelExtension: vi.fn(() => Promise.resolve()),
}
;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
;(window as unknown as { davis: unknown }).davis = davisStub

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return { id: 'p1', root: '/tmp/proj', name: 'proj', favorite: false, lastOpenedAt: 1, ...overrides }
}

afterEach(cleanup)

describe('프로젝트 사이드바', () => {
  const EMPTY_TREE = {
    children: { '': [] },
    expanded: new Set<string>(),
    loading: new Set<string>(),
    toggle: () => {},
  }
  const SIDEBAR_NOOP = {
    onFavorite: () => {},
    status: 'ready' as const,
    tree: EMPTY_TREE,
    onPickFile: () => {},
    onOpenFile: () => {},
    onTestConnection: () => {},
    git: {
      state: EMPTY_GIT_STATE,
      loading: false,
      refresh: () => {},
      toggle: async () => {},
      revert: async () => ({ ok: true }),
      commit: async () => ({ ok: true }),
      push: async () => ({ ok: true }),
      pull: async () => ({ ok: true }),
      refetch: () => {},
    },
    onOpenDiff: () => {},
    gitActions: { onRevert: () => {}, onPull: () => {}, onCommit: () => {}, onPush: () => {} },
    history: { entries: [], loading: false, loadingChatId: null, current: null },
    onToast: () => {},
    onOpenHtml: () => {},
    onSetup: () => {},
  }

  it('채팅이력에서 새 대화를 시작할 수 있다', () => {
    davisStub.resetChat.mockClear()
    render(<ProjectSidebar {...SIDEBAR_NOOP} project={project()} />)

    fireEvent.click(screen.getByText('프로젝트'))
    fireEvent.click(screen.getByText('채팅이력'))
    fireEvent.click(screen.getByText('+ 새 대화'))

    expect(davisStub.resetChat).toHaveBeenCalled()
  })

  // 연결 전이나 응답 중에는 새 대화를 시작할 수 없다
  it('응답 중에는 새 대화를 막는다', () => {
    render(<ProjectSidebar {...SIDEBAR_NOOP} newChatDisabled project={project()} />)

    fireEvent.click(screen.getByText('프로젝트'))
    fireEvent.click(screen.getByText('채팅이력'))

    expect(screen.getByText('+ 새 대화').hasAttribute('disabled')).toBe(true)
  })

  it('별을 누르면 즐겨찾기가 뒤집힌다', () => {
    const onFavorite = vi.fn()
    render(<ProjectSidebar {...SIDEBAR_NOOP} onFavorite={onFavorite} project={project()} />)

    fireEvent.click(screen.getByTitle('즐겨찾기'))
    expect(onFavorite).toHaveBeenCalled()
  })

  it('즐겨찾기면 해제 버튼으로 보인다', () => {
    render(<ProjectSidebar {...SIDEBAR_NOOP} project={project({ favorite: true })} />)
    expect(screen.getByTitle('즐겨찾기 해제').getAttribute('aria-pressed')).toBe('true')
  })

  // 채팅이력은 대화 목록이지 프로젝트 설정이 아니다
  it('채팅이력을 보는 동안에는 즐겨찾기를 감춘다', () => {
    render(<ProjectSidebar {...SIDEBAR_NOOP} project={project()} />)

    fireEvent.click(screen.getByText('프로젝트'))
    fireEvent.click(screen.getByText('채팅이력'))

    expect(screen.queryByTitle('즐겨찾기')).toBeNull()
  })

  // 이름은 탭이 이미 보여준다 — 두 번 나오면 어느 쪽이 무엇인지 헷갈린다
  it('프로젝트 이름을 되풀이하지 않고 경로만 보여준다', () => {
    render(<ProjectSidebar {...SIDEBAR_NOOP} project={project()} />)

    expect(screen.queryByText('proj')).toBeNull()
    expect(screen.getByTitle('/tmp/proj').textContent).toBe('/tmp/proj')
  })

  it('연결 상태를 글로도 보여준다 — 점만으로는 무슨 뜻인지 모른다', () => {
    render(<ProjectSidebar {...SIDEBAR_NOOP} status="disconnected" project={project()} />)
    expect(screen.getByText('연결 끊김')).toBeTruthy()
  })
})

describe('런처', () => {
  it('폴더 열기 버튼을 보여준다', () => {
    const onPick = vi.fn()
    render(<ProjectEmptyState recent={[]} onPick={onPick} onOpen={() => {}} />)

    fireEvent.click(screen.getByText('폴더 열기'))
    expect(onPick).toHaveBeenCalled()
  })

  // 전에 골랐던 프로젝트를 폴더부터 다시 찾아가게 만들면 안 된다
  it('이전에 연 프로젝트 목록을 보여주고, 누르면 그 경로를 연다', () => {
    const onOpen = vi.fn()
    render(<ProjectEmptyState recent={[project()]} onPick={() => {}} onOpen={onOpen} />)

    expect(screen.getByText('최근')).toBeTruthy()
    fireEvent.click(screen.getByTitle('/tmp/proj'))
    expect(onOpen).toHaveBeenCalledWith('/tmp/proj')
  })

  it('최근이 없으면 목록 자체를 그리지 않는다', () => {
    render(<ProjectEmptyState recent={[]} onPick={() => {}} onOpen={() => {}} />)

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.queryByText('최근')).toBeNull()
  })

  // 정렬만 다르고 같은 줄로 보이면 즐겨찾기를 한 의미가 없다
  it('즐겨찾기와 최근을 다른 묶음으로 나눈다', () => {
    const recent = [
      project({ id: 'p1', root: '/tmp/star', name: 'star', favorite: true }),
      project({ id: 'p2', root: '/tmp/plain', name: 'plain' }),
    ]
    render(<ProjectEmptyState recent={recent} onPick={() => {}} onOpen={() => {}} />)

    expect(screen.getByText('즐겨찾기')).toBeTruthy()
    expect(screen.getByText('최근')).toBeTruthy()
  })

  // 폴더명이 곧 이름이면 두 번 읽히지 않게 부모 경로만 — 전체 경로는 title 로 남는다
  it('이름과 겹치는 마지막 칸을 경로에서 뗀다', () => {
    render(<ProjectEmptyState recent={[project()]} onPick={() => {}} onOpen={() => {}} />)

    expect(screen.getByText('/tmp')).toBeTruthy()
    expect(screen.getByTitle('/tmp/proj')).toBeTruthy()
  })

  it('이름을 바꾼 프로젝트는 경로를 통째로 남긴다 — 떼면 어느 폴더인지 모른다', () => {
    render(
      <ProjectEmptyState
        recent={[project({ name: '다비스' })]}
        onPick={() => {}}
        onOpen={() => {}}
      />,
    )

    expect(screen.getByText('/tmp/proj')).toBeTruthy()
  })

  it('목록이 길면 이름·경로 어느 쪽으로 쳐도 걸러진다', () => {
    const recent = [
      project({ id: 'p1', root: '/tmp/alpha', name: 'alpha' }),
      project({ id: 'p2', root: '/tmp/beta', name: 'beta' }),
      project({ id: 'p3', root: '/srv/gamma', name: 'gamma' }),
      project({ id: 'p4', root: '/tmp/delta', name: 'delta' }),
      project({ id: 'p5', root: '/tmp/epsilon', name: 'epsilon' }),
    ]
    render(<ProjectEmptyState recent={recent} onPick={() => {}} onOpen={() => {}} />)

    fireEvent.change(screen.getByLabelText('최근 프로젝트 거르기'), { target: { value: 'srv' } })

    expect(screen.getByText('gamma')).toBeTruthy()
    expect(screen.queryByText('alpha')).toBeNull()

    fireEvent.change(screen.getByLabelText('최근 프로젝트 거르기'), { target: { value: 'zzz' } })
    expect(screen.getByText('거른 결과가 없습니다.')).toBeTruthy()
  })

  // 몇 개 안 되는데 검색칸부터 보이면 목록이 길어 보인다
  it('최근이 적으면 거르는 줄을 내지 않는다', () => {
    render(<ProjectEmptyState recent={[project()]} onPick={() => {}} onOpen={() => {}} />)
    expect(screen.queryByLabelText('최근 프로젝트 거르기')).toBeNull()
  })

  it('첫 실행에는 돌아갈 곳이 없어 되돌아가기도 없다', () => {
    render(<ProjectEmptyState recent={[]} onPick={() => {}} onOpen={() => {}} />)
    expect(screen.queryByText('지금 화면으로 돌아가기')).toBeNull()
  })

  it('열린 프로젝트가 있을 때는 되돌아간다', () => {
    const onCancel = vi.fn()
    render(<ProjectEmptyState recent={[]} onPick={() => {}} onOpen={() => {}} onCancel={onCancel} />)

    fireEvent.click(screen.getByText('지금 화면으로 돌아가기'))
    expect(onCancel).toHaveBeenCalled()
  })
})
