// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScmChanges } from './ScmChanges'
import type { GitFileEntry, GitState } from '../../shared/git/gitState'
import type { ScmViewHandle } from '../state/useScmView'
import type { GitActionResult, GitDiffResultPayload } from '../../shared/ipc/gitPayloads'

// `ScmChanges.test.tsx` 에서 갈라 나온 절반 — **오른쪽 칸**(`ScmDiffPane`)만 본다.
// 가른 이유는 300줄 상한이다 (선례: `parseTurnReview.more.test.ts`). 준비부는 같다.
//
// 여기가 잠그는 것.
//  1. 머리의 파일 통째 행동은 **고른 묶음의 반대쪽**으로 간다
//  2. 머리의 되돌리기는 덩어리 되돌리기와 **다른 채널**이다
//  3. 못 읽음 · 추적 안 됨 · 반대쪽으로 옮겨 감 — 셋이 각각 다른 화면이다

const DIFF = ['@@ -1,2 +1,2 @@ head', ' keep', '-old', '+new', ''].join('\n')

const gitFileDiff = vi.fn<() => Promise<GitDiffResultPayload>>()
const gitStageHunk = vi.fn<() => Promise<GitActionResult>>()
const gitRevertHunk = vi.fn<() => Promise<GitActionResult>>()

afterEach(cleanup)

function entry(path: string, patch: Partial<GitFileEntry> = {}): GitFileEntry {
  return { path, status: 'modified', ...patch }
}

function state(patch: Partial<GitState> = {}): GitState {
  return {
    isRepo: true,
    branch: 'feat/x',
    upstream: 'origin/feat/x',
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [entry('src/App.tsx')],
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

function wiring() {
  return {
    projectId: 'p1',
    toasts: { toasts: [], show: vi.fn(), dismiss: vi.fn() },
    bulk: { onStageAll: vi.fn(), onUnstageAll: vi.fn() },
    onToggle: vi.fn(),
    onRevert: vi.fn(),
    onCommit: vi.fn(),
    onPush: vi.fn(),
  }
}

/** 고른 파일을 실제로 쥐는 껍데기 (`ScmChanges.test.tsx` 의 것과 같다). */
function Harness({ gitState, wire }: { gitState: GitState; wire: ReturnType<typeof wiring> }) {
  const [file, setFile] = useState<string | null>(null)
  const view: ScmViewHandle = {
    view: 'changes',
    selectView: vi.fn(),
    file,
    selectFile: setFile,
    commit: null,
    selectCommit: vi.fn(),
  }
  return <ScmChanges {...wire} state={gitState} loading={false} view={view} />
}

beforeEach(() => {
  gitFileDiff.mockReset().mockResolvedValue({ ok: true, diff: DIFF })
  gitStageHunk.mockReset().mockResolvedValue({ ok: true })
  gitRevertHunk.mockReset().mockResolvedValue({ ok: true })
  ;(window as unknown as { davis: unknown }).davis = { gitFileDiff, gitStageHunk, gitRevertHunk }
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('오른쪽 칸 머리 — 파일 통째 행동', () => {
  // 머리의 버튼은 **고른 묶음의 반대쪽**으로 옮긴다. 안 담긴 것은 담고, 담긴 것은 뺀다.
  it('안 담긴 파일이면 담기를 부른다', async () => {
    const wire = wiring()
    render(
      <ScmChanges {...wire} state={state()} loading={false} view={viewHandle({ file: 'src/App.tsx' })} />,
    )
    await screen.findByText('@@ -1,2 +1,2 @@ head')

    fireEvent.click(screen.getByRole('button', { name: '파일 담기' }))

    expect(wire.onToggle).toHaveBeenCalledWith('src/App.tsx', true)
  })

  // 묶음은 목록을 눌러야 갈리므로 `Harness` 로 실제 선택을 거친다
  it('담긴 파일이면 담기 취소를 부른다', async () => {
    const wire = wiring()
    render(<Harness gitState={state({ staged: [entry('src/App.tsx')], unstaged: [] })} wire={wire} />)
    fireEvent.click(screen.getByRole('button', { name: /App\.tsx/ }))
    await screen.findByText('@@ -1,2 +1,2 @@ head')

    fireEvent.click(screen.getByRole('button', { name: '담기 취소' }))

    expect(wire.onToggle).toHaveBeenCalledWith('src/App.tsx', false)
  })

  // 위와 짝이 되는 반대 방향. 머리와 덩어리가 **같은 글자("되돌리기")** 를 달고 있어
  // 배선이 뒤바뀌어도 화면으로는 안 보인다 — 어느 채널로 갔는지로만 가려낼 수 있다.
  it('덩어리의 되돌리기는 그 덩어리만 되돌린다 — 파일 통째 채널로 새지 않는다', async () => {
    const wire = wiring()
    const { container } = render(
      <ScmChanges {...wire} state={state()} loading={false} view={viewHandle({ file: 'src/App.tsx' })} />,
    )
    await screen.findByText('@@ -1,2 +1,2 @@ head')

    const hunk = container.querySelector('.scm-hunk')!
    fireEvent.click(within(hunk as HTMLElement).getByRole('button', { name: '되돌리기' }))

    // 되돌릴 수 없는 행동이라 한 번 묻는다
    expect(window.confirm).toHaveBeenCalled()
    expect(gitRevertHunk).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'src/App.tsx',
      hunkIndex: 0,
      // 되만든 문자열이 아니라 원문 그대로여야 main 이 받는다
      hunkText: '@@ -1,2 +1,2 @@ head\n keep\n-old\n+new',
    })
    expect(wire.onRevert).not.toHaveBeenCalled()
  })

  it('머리의 되돌리기는 파일 통째로 되돌린다 — 덩어리 되돌리기와 다른 행동이다', async () => {
    const wire = wiring()
    const { container } = render(
      <ScmChanges {...wire} state={state()} loading={false} view={viewHandle({ file: 'src/App.tsx' })} />,
    )
    await screen.findByText('@@ -1,2 +1,2 @@ head')

    const head = container.querySelector('.scm-diff__head')!
    fireEvent.click(within(head as HTMLElement).getByRole('button', { name: '되돌리기' }))

    expect(wire.onRevert).toHaveBeenCalledWith('src/App.tsx')
    // 덩어리 쪽 채널로 새지 않았다
    expect(gitRevertHunk).not.toHaveBeenCalled()
  })
})

describe('오른쪽 칸 — 읽지 못했거나 비교할 것이 없을 때', () => {
  it('못 읽었으면 사유를 그대로 보인다', async () => {
    gitFileDiff.mockResolvedValue({ ok: false, diff: '', reason: '너무 큽니다' })
    render(
      <ScmChanges {...wiring()} state={state()} loading={false} view={viewHandle({ file: 'src/App.tsx' })} />,
    )

    expect(await screen.findByText('너무 큽니다')).toBeTruthy()
  })

  // 추적 안 되는 파일은 비교 대상이 없다 — 덩어리가 아니라 내용을 통째로 그리고,
  // 되돌릴 이전 내용이 없으니 되돌리기를 그리지 않는다.
  it('추적 안 되는 파일은 내용을 통째로 보이고 되돌리기를 안 그린다', async () => {
    gitFileDiff.mockResolvedValue({ ok: true, diff: '첫 줄\n둘째 줄', untracked: true })
    render(
      <ScmChanges
        {...wiring()}
        state={state({ unstaged: [entry('new.ts', { status: 'untracked' })] })}
        loading={false}
        view={viewHandle({ file: 'new.ts' })}
      />,
    )

    expect(await screen.findByText('첫 줄')).toBeTruthy()
    expect(screen.getByText('둘째 줄')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull()
  })

  // 🔴 반대쪽 묶음에서 몰래 찾아 그리면 왼쪽 목록과 어긋난 행동 버튼이 뜬다
  //    (담긴 파일에 "파일 담기" 가 뜨는 식).
  it('고른 파일이 반대쪽으로 옮겨 갔으면 행동을 그리지 않는다', async () => {
    render(
      <ScmChanges
        {...wiring()}
        state={state({ staged: [entry('src/App.tsx')], unstaged: [] })}
        loading={false}
        view={viewHandle({ file: 'src/App.tsx' })}
      />,
    )

    await screen.findByText('@@ -1,2 +1,2 @@ head')
    expect(screen.queryByRole('button', { name: '파일 담기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '담기 취소' })).toBeNull()
  })
})
