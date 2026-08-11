// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScmTab } from './ScmTab'
import type { GitFileEntry, GitState } from '../../shared/git/gitState'
import type { ScmViewHandle } from '../state/useScmView'

// 소스 관리 탭 껍데기. 갈래 줄과 개수, 그리고 사이드바와 같은 문구를 잠근다.
// 갈래 **안**의 내용은 아직 없다 — 자리만 있다.

afterEach(cleanup)

function entry(path: string): GitFileEntry {
  return { path, status: 'modified' }
}

function state(patch: Partial<GitState> = {}): GitState {
  return {
    isRepo: true,
    branch: 'feat/x',
    upstream: 'origin/feat/x',
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    ...patch,
  }
}

function viewHandle(patch: Partial<ScmViewHandle> = {}): ScmViewHandle {
  return {
    view: 'changes',
    selectView: vi.fn(),
    file: null,
    selectFile: vi.fn(),
    commit: null,
    selectCommit: vi.fn(),
    ...patch,
  }
}

const NOOP = { loading: false, onRefresh: () => {}, onPull: () => {} }

describe('ScmTab — 갈래 줄', () => {
  it('갈래 3개가 순서대로 서고 지금 갈래만 선택돼 있다', () => {
    render(<ScmTab {...NOOP} state={state()} view={viewHandle({ view: 'history' })} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['변경사항0', '히스토리', '브랜치'])
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
  })

  it('갈래를 누르면 고른 갈래를 알린다', () => {
    const view = viewHandle()
    render(<ScmTab {...NOOP} state={state()} view={view} />)

    fireEvent.click(screen.getByText('브랜치'))

    expect(view.selectView).toHaveBeenCalledWith('branches')
  })

  it('변경사항 개수는 양쪽에 다 있는 파일을 한 번만 센다 — 담은 뒤 또 고친 파일', () => {
    render(
      <ScmTab
        {...NOOP}
        state={state({ staged: [entry('a.ts'), entry('b.ts')], unstaged: [entry('a.ts')] })}
        view={viewHandle()}
      />,
    )

    expect(screen.getByRole('tab', { name: /변경사항/ }).textContent).toBe('변경사항2')
  })

  it('브랜치 개수는 목록을 읽어 오기 전에는 안 그린다 — 0 을 지어내지 않는다', () => {
    const { rerender } = render(<ScmTab {...NOOP} state={state()} view={viewHandle()} />)
    expect(screen.getByRole('tab', { name: /브랜치/ }).textContent).toBe('브랜치')

    rerender(<ScmTab {...NOOP} state={state()} view={viewHandle()} branchCount={0} />)
    expect(screen.getByRole('tab', { name: /브랜치/ }).textContent).toBe('브랜치0')
  })

  it('갈래 본문 자리는 지금 갈래의 이름을 달고 하나만 선다', () => {
    render(<ScmTab {...NOOP} state={state()} view={viewHandle({ view: 'branches' })} />)

    const panes = screen.getAllByRole('tabpanel')
    expect(panes).toHaveLength(1)
    expect(panes[0]?.getAttribute('aria-label')).toBe('브랜치')
  })
})

describe('ScmTab — 브랜치 줄은 사이드바와 같은 것을 쓴다', () => {
  it('↑↓ 는 둘 다 0이면 안 그린다 (GitBranchBar 규칙)', () => {
    const { rerender } = render(<ScmTab {...NOOP} state={state()} view={viewHandle()} />)
    expect(screen.queryByText(/↑|↓/)).toBeNull()

    rerender(<ScmTab {...NOOP} state={state({ ahead: 2, behind: 3 })} view={viewHandle()} />)
    expect(screen.getByText('↑2')).toBeTruthy()
    expect(screen.getByText('↓3')).toBeTruthy()
  })

  it('원격이 앞서면 당겨오기가 뜨고 누르면 그 행동을 부른다', () => {
    const onPull = vi.fn()
    render(
      <ScmTab {...NOOP} onPull={onPull} state={state({ behind: 3 })} view={viewHandle()} />,
    )

    fireEvent.click(screen.getByText('당겨오기'))

    expect(onPull).toHaveBeenCalledTimes(1)
  })
})

describe('ScmTab — 히스토리·브랜치 갈래 마운트', () => {
  const gitLog = vi.fn().mockResolvedValue({ ok: true, commits: [], hasMore: false })
  const gitBranches = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      branches: [{ name: 'main', remote: false, date: '', track: '', current: true }],
    })
  const gitStashes = vi.fn().mockResolvedValue({ ok: true, stashes: [] })
  const toasts = { toasts: [], show: vi.fn(), dismiss: vi.fn() }

  beforeEach(() => {
    // 앞 케이스의 호출을 지운다 (구현은 그대로 둔다) — "부르지 않았다" 를 단언하려면 필요하다
    for (const fn of [gitLog, gitBranches, gitStashes]) fn.mockClear()
    ;(window as unknown as { davis: unknown }).davis = { gitLog, gitBranches, gitStashes }
  })

  it('배선을 주면 히스토리 갈래가 선다', async () => {
    render(
      <ScmTab
        {...NOOP}
        state={state()}
        view={viewHandle({ view: 'history' })}
        refs={{ projectId: 'p1', toasts }}
      />,
    )

    expect(await screen.findByText('아직 커밋이 없습니다.')).toBeTruthy()
  })

  it('배선을 주면 브랜치 갈래가 서고 개수도 그 목록에서 나온다', async () => {
    render(
      <ScmTab
        {...NOOP}
        state={state()}
        view={viewHandle({ view: 'branches' })}
        refs={{ projectId: 'p1', toasts }}
      />,
    )

    expect(await screen.findByText('원격 브랜치가 없습니다.')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /브랜치/ }).textContent).toBe('브랜치1')
  })

  it('배선을 주면 변경사항 갈래가 선다', async () => {
    const bulk = { onStageAll: vi.fn(), onUnstageAll: vi.fn() }
    render(
      <ScmTab
        {...NOOP}
        state={state()}
        view={viewHandle({ view: 'changes' })}
        refs={{ projectId: 'p1', toasts }}
        changes={{
          projectId: 'p1',
          toasts,
          bulk,
          onToggle: vi.fn(),
          onRevert: vi.fn(),
          onCommit: vi.fn(),
          onPush: vi.fn(),
        }}
      />,
    )

    expect(
      await screen.findByText('왼쪽에서 파일을 고르면 변경 내용이 보입니다.'),
    ).toBeTruthy()
  })

  // 🔴 ⟳ 가 상태만 다시 읽으면 브랜치 목록은 밀려오지 않아 옛것으로 남는다
  //    (`useGitRefs` 머리말). 한 번 누르면 양쪽이 같이 맞아야 한다.
  it('⟳ 는 상태와 목록을 함께 다시 읽는다', async () => {
    const onRefresh = vi.fn()
    render(
      <ScmTab
        {...NOOP}
        onRefresh={onRefresh}
        state={state()}
        view={viewHandle({ view: 'branches' })}
        refs={{ projectId: 'p1', toasts }}
      />,
    )
    await screen.findByText('원격 브랜치가 없습니다.')
    expect(gitBranches).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTitle('다시 읽기'))

    expect(onRefresh).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(gitBranches).toHaveBeenCalledTimes(2))
  })

  // 배선이 없으면 조회를 아예 하지 않는다 (껍데기만 띄우는 자리)
  it('배선이 없으면 그 갈래 본문이 빈 채로 있다', () => {
    render(<ScmTab {...NOOP} state={state()} view={viewHandle({ view: 'branches' })} />)

    expect(screen.queryByText('원격 브랜치가 없습니다.')).toBeNull()
    expect(gitBranches).not.toHaveBeenCalled()
  })
})

describe('ScmTab — 그릴 것이 없을 때', () => {
  it('저장소가 아니면 사이드바와 같은 문구만 낸다 (갈래 줄 없음)', () => {
    render(<ScmTab {...NOOP} state={state({ isRepo: false })} view={viewHandle()} />)

    expect(screen.getByText('git 저장소가 아닙니다.')).toBeTruthy()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('git 이 실패했으면 그 사유를 낸다', () => {
    render(<ScmTab {...NOOP} state={state({ error: 'git 을 찾지 못했습니다' })} view={viewHandle()} />)

    expect(screen.getByText('git 을 찾지 못했습니다')).toBeTruthy()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })
})
