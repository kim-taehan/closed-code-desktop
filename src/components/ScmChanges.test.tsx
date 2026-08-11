// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScmChanges } from './ScmChanges'
import type { GitFileEntry, GitState } from '../../shared/git/gitState'
import type { ScmViewHandle } from '../state/useScmView'
import type { GitActionResult, GitDiffResultPayload } from '../../shared/ipc/gitPayloads'

// 이 갈래의 존재 이유는 **탭을 늘리지 않고** 파일을 보는 것이다.
// `ScmChanges` 는 `useOpenFiles` 를 아예 받지 않는다 — 여기서 탭을 만들 방법이 없다.
// 아래 테스트는 파일을 눌렀을 때 실제로 diff 를 **제자리에서** 읽는지 잠근다.

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

/**
 * 고른 파일을 실제로 쥐는 껍데기.
 *
 * `ScmChanges` 는 선택을 스스로 들고 있지 않다 — 위(`useScmView`)가 쥔다. 그래서
 * 누르면 화면이 바뀌는지 보려면 여기서 그 역할을 대신해야 한다.
 */
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

describe('파일을 고르면 — 탭을 만들지 않는다', () => {
  it('고른 것을 알리고 그 자리에서 diff 를 읽는다', async () => {
    render(<Harness gitState={state()} wire={wiring()} />)

    fireEvent.click(screen.getByRole('button', { name: /App\.tsx/ }))

    await waitFor(() =>
      expect(gitFileDiff).toHaveBeenCalledWith({
        projectId: 'p1',
        path: 'src/App.tsx',
        staged: false,
      }),
    )
    // 화면이 그 자리에서 바뀐다 — 탭을 만들지 않는다 (openFiles 를 아예 받지 않는다)
    expect(await screen.findByText('@@ -1,2 +1,2 @@ head')).toBeTruthy()
  })

  it('고른 파일을 알리기만 한다 — 목록이 아는 것은 그것뿐이다', () => {
    const view = viewHandle()
    render(<ScmChanges {...wiring()} state={state()} loading={false} view={view} />)

    fireEvent.click(screen.getByRole('button', { name: /App\.tsx/ }))

    expect(view.selectFile).toHaveBeenCalledWith('src/App.tsx')
  })

  it('고른 파일의 덩어리 머리를 원문 그대로 보여준다', async () => {
    render(
      <ScmChanges {...wiring()} state={state()} loading={false} view={viewHandle({ file: 'src/App.tsx' })} />,
    )

    expect(await screen.findByText('@@ -1,2 +1,2 @@ head')).toBeTruthy()
  })

  it('아무것도 안 골랐으면 안내만 두고 묻지 않는다', () => {
    render(<ScmChanges {...wiring()} state={state()} loading={false} view={viewHandle()} />)

    expect(screen.getByText('왼쪽에서 파일을 고르면 변경 내용이 보입니다.')).toBeTruthy()
    expect(gitFileDiff).not.toHaveBeenCalled()
  })
})

describe('덩어리 담기', () => {
  it('덩어리 원문(머리+본문)을 실어 보내고, 담은 뒤 diff 를 다시 읽는다', async () => {
    render(
      <ScmChanges {...wiring()} state={state()} loading={false} view={viewHandle({ file: 'src/App.tsx' })} />,
    )
    await screen.findByText('@@ -1,2 +1,2 @@ head')

    fireEvent.click(screen.getByRole('button', { name: '이 덩어리 담기' }))

    await waitFor(() =>
      expect(gitStageHunk).toHaveBeenCalledWith({
        projectId: 'p1',
        path: 'src/App.tsx',
        hunkIndex: 0,
        // 머리 한 줄이 아니다 — 본문까지 원문 그대로여야 main 이 제자리 내용 변경을 잡는다
        hunkText: '@@ -1,2 +1,2 @@ head\n keep\n-old\n+new',
      }),
    )
    // 다시 읽지 않으면 다음 덩어리 클릭이 밀린 인덱스로 가 거절된다
    await waitFor(() => expect(gitFileDiff).toHaveBeenCalledTimes(2))
  })

  it('담긴 쪽에서 고르면 그쪽 diff 를 묻고 덩어리 행동을 그리지 않는다', async () => {
    render(
      <Harness gitState={state({ staged: [entry('src/App.tsx')], unstaged: [] })} wire={wiring()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /App\.tsx/ }))

    await waitFor(() =>
      expect(gitFileDiff).toHaveBeenCalledWith({
        projectId: 'p1',
        path: 'src/App.tsx',
        staged: true,
      }),
    )
    await screen.findByText('@@ -1,2 +1,2 @@ head')
    // 이미 담긴 것을 또 담을 수는 없다 — 눌리지 않는 버튼을 남기지 않는다
    expect(screen.queryByRole('button', { name: '이 덩어리 담기' })).toBeNull()
  })
})

describe('빈 상태 — 사이드바와 같은 말을 쓴다', () => {
  it('변경이 없으면 사이드바와 같은 문구', () => {
    render(
      <ScmChanges {...wiring()} state={state({ unstaged: [] })} loading={false} view={viewHandle()} />,
    )

    expect(screen.getByText('변경된 파일이 없습니다.')).toBeTruthy()
  })
})

describe('커밋바', () => {
  it('담긴 것이 없으면 커밋할 수 없다', () => {
    render(<ScmChanges {...wiring()} state={state()} loading={false} view={viewHandle()} />)

    fireEvent.change(screen.getByPlaceholderText('커밋 메시지'), { target: { value: '메시지' } })

    expect(screen.getByRole('button', { name: '커밋' }).hasAttribute('disabled')).toBe(true)
  })

  it('담긴 것이 있고 메시지를 쓰면 커밋한다', () => {
    const props = wiring()
    render(
      <ScmChanges
        {...props}
        state={state({ staged: [entry('a.ts')] })}
        loading={false}
        view={viewHandle()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('커밋 메시지'), { target: { value: ' 메시지 ' } })
    fireEvent.click(screen.getByRole('button', { name: '커밋' }))

    expect(props.onCommit).toHaveBeenCalledWith('메시지')
  })

  // 업스트림이 아직 없는 브랜치의 **첫 푸시**를 막으면 안 된다 — 올려야 원격이 생긴다.
  // (`GitPanel` 과 같은 판정. 두 자리가 갈리면 같은 저장소가 자리마다 다르게 보인다.)
  it('업스트림이 없어도 브랜치가 있으면 올릴 수 있다', () => {
    const { rerender } = render(
      <ScmChanges
        {...wiring()}
        state={state({ upstream: null, ahead: 0 })}
        loading={false}
        view={viewHandle()}
      />,
    )
    expect(screen.getByRole('button', { name: '푸시' }).hasAttribute('disabled')).toBe(false)

    // 커밋이 하나도 없어 브랜치조차 없으면 올릴 것이 없다
    rerender(
      <ScmChanges
        {...wiring()}
        state={state({ upstream: null, ahead: 0, branch: null })}
        loading={false}
        view={viewHandle()}
      />,
    )
    expect(screen.getByRole('button', { name: '푸시' }).hasAttribute('disabled')).toBe(true)
  })
})
