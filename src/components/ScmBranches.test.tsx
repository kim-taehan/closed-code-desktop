// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScmBranches } from './ScmBranches'
import type { GitBranchEntry, GitStashEntry } from '../../shared/git/gitRefs'
import type { GitRefsHandle } from '../state/useGitRefs'
import type { GitRefActions } from '../state/useGitRefActions'

// 브랜치 갈래가 잠그는 것.
//  1. 로컬/원격/임시저장이 갈려 있고 각자 할 수 있는 행동만 그린다
//  2. **안전 삭제와 강제 삭제가 화면에서 구분된다**
//  3. 지금 있는 브랜치에는 전환·병합·삭제를 그리지 않는다
//  4. 추적 문구는 git 원문 그대로

afterEach(cleanup)

function branch(patch: Partial<GitBranchEntry> = {}): GitBranchEntry {
  return { name: 'main', remote: false, date: '2026-07-31 14:20:33 +0900', track: '', current: false, ...patch }
}

function stash(patch: Partial<GitStashEntry> = {}): GitStashEntry {
  return { ref: 'stash@{0}', date: '2026-07-31 14:20:33 +0900', label: 'On main: 확장 설치 화면', ...patch }
}

function refsHandle(patch: Partial<GitRefsHandle> = {}): GitRefsHandle {
  return {
    branches: [],
    stashes: [],
    loading: false,
    error: null,
    reload: vi.fn().mockResolvedValue({ branches: [], stashes: [] }),
    ...patch,
  }
}

function actions(): GitRefActions {
  return {
    busy: false,
    onSwitch: vi.fn(),
    onCreate: vi.fn(),
    onTrack: vi.fn(),
    onMerge: vi.fn(),
    onDelete: vi.fn(),
    onForceDelete: vi.fn(),
    onStash: vi.fn(),
    onApplyStash: vi.fn(),
    onDropStash: vi.fn(),
  }
}

describe('ScmBranches — 세 칸', () => {
  it('로컬과 원격을 갈라 세고, 원격에는 받아오기만 둔다', () => {
    const act = actions()
    render(
      <ScmBranches
        refs={refsHandle({
          branches: [branch({ name: 'main' }), branch({ name: 'origin/main', remote: true })],
        })}
        actions={act}
      />,
    )

    fireEvent.click(screen.getByText('로컬로 받아오기'))
    expect(act.onTrack).toHaveBeenCalledWith('origin/main')
    // 원격 브랜치에 전환을 부르면 git 이 거절한다 — 로컬 줄에만 전환이 있다
    expect(screen.getAllByText('전환')).toHaveLength(1)
  })

  it('지금 있는 브랜치에는 전환·병합·삭제를 그리지 않는다', () => {
    render(
      <ScmBranches
        refs={refsHandle({ branches: [branch({ name: 'main', current: true })] })}
        actions={actions()}
      />,
    )

    expect(screen.queryByText('전환')).toBeNull()
    expect(screen.queryByText('현재에 병합')).toBeNull()
    expect(screen.queryByText('삭제')).toBeNull()
  })

  // 🔴 둘이 같은 버튼으로 보이면 한 번의 오클릭으로 커밋이 사라진다
  it('안전 삭제와 강제 삭제가 화면에서 구분되고 서로 다른 행동을 부른다', () => {
    const act = actions()
    render(
      <ScmBranches refs={refsHandle({ branches: [branch({ name: 'old' })] })} actions={act} />,
    )

    fireEvent.click(screen.getByText('삭제'))
    expect(act.onDelete).toHaveBeenCalledWith('old')
    expect(act.onForceDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('강제 삭제'))
    expect(act.onForceDelete).toHaveBeenCalledWith('old')
  })

  it('추적 문구는 git 원문 그대로 보인다 — 숫자로 풀지 않는다', () => {
    render(
      <ScmBranches
        refs={refsHandle({ branches: [branch({ name: 'feat', track: '[ahead 2, behind 3]' })] })}
        actions={actions()}
      />,
    )

    expect(screen.getByText('[ahead 2, behind 3]')).toBeTruthy()
  })

  it('업스트림이 지워진 브랜치의 [gone] 도 그대로 보인다', () => {
    render(
      <ScmBranches
        refs={refsHandle({ branches: [branch({ name: 'feat', track: '[gone]' })] })}
        actions={actions()}
      />,
    )

    expect(screen.getByText('[gone]')).toBeTruthy()
  })

  it('못 읽었으면 git 문구를 그대로 낸다', () => {
    render(
      <ScmBranches refs={refsHandle({ error: 'fatal: not a git repository' })} actions={actions()} />,
    )

    expect(screen.getByText('fatal: not a git repository')).toBeTruthy()
  })

  it('비어 있으면 칸마다 빈 상태 문구를 둔다', () => {
    render(<ScmBranches refs={refsHandle()} actions={actions()} />)

    expect(screen.getByText('로컬 브랜치가 없습니다.')).toBeTruthy()
    expect(screen.getByText('원격 브랜치가 없습니다.')).toBeTruthy()
    expect(screen.getByText('치워 둔 것이 없습니다.')).toBeTruthy()
  })
})

describe('ScmBranches — 임시저장', () => {
  it('복원과 버리기가 갈려 있다 — 복원해도 목록에 남는다', () => {
    const act = actions()
    render(<ScmBranches refs={refsHandle({ stashes: [stash()] })} actions={act} />)

    fireEvent.click(screen.getByText('복원'))
    expect(act.onApplyStash).toHaveBeenCalledWith('stash@{0}')

    fireEvent.click(screen.getByText('버리기'))
    expect(act.onDropStash).toHaveBeenCalledWith('stash@{0}')
  })

  it('없는 기능의 버튼을 만들지 않는다 — pop·내용 보기는 그리지 않는다', () => {
    render(<ScmBranches refs={refsHandle({ stashes: [stash()] })} actions={actions()} />)

    expect(screen.queryByText(/꺼내기|pop|내용 보기/)).toBeNull()
  })
})

describe('ScmBranches — 이름 받기', () => {
  it('새 브랜치는 제자리 입력칸으로 받는다 (Electron 은 prompt 가 없다)', () => {
    const act = actions()
    render(<ScmBranches refs={refsHandle()} actions={act} />)

    fireEvent.click(screen.getByText('+ 새 브랜치'))
    fireEvent.change(screen.getByLabelText('새 브랜치 이름'), { target: { value: ' feat/x ' } })
    fireEvent.submit(screen.getByLabelText('새 브랜치 이름'))

    // 앞뒤 공백은 턴다 — git 이 refname 으로 거절한다
    expect(act.onCreate).toHaveBeenCalledWith('feat/x')
  })

  it('빈 이름으로는 부르지 않는다', () => {
    const act = actions()
    render(<ScmBranches refs={refsHandle()} actions={act} />)

    fireEvent.click(screen.getByText('+ 새 브랜치'))
    fireEvent.submit(screen.getByLabelText('새 브랜치 이름'))

    expect(act.onCreate).not.toHaveBeenCalled()
  })

  // 제자리 입력칸이라 닫을 길이 필요하다 — prompt 와 달리 취소 버튼이 없다.
  it('Esc 를 누르면 입력칸을 접고 아무것도 부르지 않는다', () => {
    const act = actions()
    render(<ScmBranches refs={refsHandle()} actions={act} />)

    fireEvent.click(screen.getByText('+ 새 브랜치'))
    fireEvent.change(screen.getByLabelText('새 브랜치 이름'), { target: { value: 'feat/x' } })
    fireEvent.keyDown(screen.getByLabelText('새 브랜치 이름'), { key: 'Escape' })

    expect(screen.queryByLabelText('새 브랜치 이름')).toBeNull()
    expect(screen.getByText('+ 새 브랜치')).toBeTruthy()
    expect(act.onCreate).not.toHaveBeenCalled()
  })

  it('임시저장 설명도 같은 방식으로 받는다', () => {
    const act = actions()
    render(<ScmBranches refs={refsHandle()} actions={act} />)

    fireEvent.click(screen.getByText('+ 지금 것 저장'))
    fireEvent.change(screen.getByLabelText('무엇을 담는지'), { target: { value: 'WIP' } })
    fireEvent.submit(screen.getByLabelText('무엇을 담는지'))

    expect(act.onStash).toHaveBeenCalledWith('WIP')
  })
})
