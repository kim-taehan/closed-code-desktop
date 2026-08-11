// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileTree } from './FileTree'
import type { FileTreeApi } from '../state/useFileTree'
import type { DirEntryPayload } from '../../shared/ipc/channels'

afterEach(cleanup)

function dir(name: string, path = name): DirEntryPayload {
  return { name, path, isDirectory: true }
}

function file(name: string, path = name): DirEntryPayload {
  return { name, path, isDirectory: false }
}

function tree(overrides: Partial<FileTreeApi> = {}): FileTreeApi {
  return {
    children: {},
    expanded: new Set(),
    loading: new Set(),
    toggle: () => {},
    ...overrides,
  }
}

describe('파일 트리', () => {
  it('루트를 아직 못 읽었으면 읽는 중이라고 알린다', () => {
    render(<FileTree tree={tree()} onOpenFile={() => {}} onPickFile={() => {}} />)
    expect(screen.getByText('읽는 중…')).toBeTruthy()
  })

  // 빈 폴더와 "아직 안 읽음" 은 다르다 — 같이 보이면 사용자가 잘못 판단한다
  it('빈 프로젝트는 읽는 중과 다르게 보인다', () => {
    render(<FileTree tree={tree({ children: { '': [] } })} onOpenFile={() => {}} onPickFile={() => {}} />)
    expect(screen.getByText('파일이 없습니다')).toBeTruthy()
  })

  it('루트 항목을 그린다', () => {
    const api = tree({ children: { '': [dir('src'), file('README.md')] } })
    render(<FileTree tree={api} onOpenFile={() => {}} onPickFile={() => {}} />)

    expect(screen.getByText('src')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('디렉토리를 누르면 펼침을 뒤집는다', () => {
    const toggle = vi.fn()
    const api = tree({ children: { '': [dir('src')] }, toggle })
    render(<FileTree tree={api} onOpenFile={() => {}} onPickFile={() => {}} />)

    fireEvent.click(screen.getByText('src'))
    expect(toggle).toHaveBeenCalledWith('src')
  })

  it('파일을 누르면 연다', () => {
    const onOpenFile = vi.fn()
    const toggle = vi.fn()
    const api = tree({ children: { '': [file('README.md')] }, toggle })
    render(<FileTree tree={api} onOpenFile={onOpenFile} onPickFile={() => {}} />)

    fireEvent.click(screen.getByText('README.md'))
    expect(onOpenFile).toHaveBeenCalledWith('README.md')
    expect(toggle).not.toHaveBeenCalled()
  })

  // 한 번의 누름에 두 뜻을 담으면 어느 쪽이 일어날지 예측할 수 없다
  it('＠ 는 열지 않고 경로만 넣는다', () => {
    const onOpenFile = vi.fn()
    const onPickFile = vi.fn()
    const api = tree({ children: { '': [file('README.md')] } })
    render(<FileTree tree={api} onOpenFile={onOpenFile} onPickFile={onPickFile} />)

    fireEvent.click(screen.getByTitle('대화에 경로 넣기'))
    expect(onPickFile).toHaveBeenCalledWith('README.md')
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('디렉토리에는 ＠ 가 없다', () => {
    const api = tree({ children: { '': [dir('src')] } })
    render(<FileTree tree={api} onOpenFile={() => {}} onPickFile={() => {}} />)

    expect(screen.queryByTitle('대화에 경로 넣기')).toBeNull()
  })

  it('펼친 디렉토리의 자식을 안쪽에 그린다', () => {
    const api = tree({
      children: { '': [dir('src')], src: [file('index.ts', 'src/index.ts')] },
      expanded: new Set(['src']),
    })
    render(<FileTree tree={api} onOpenFile={() => {}} onPickFile={() => {}} />)

    expect(screen.getByText('index.ts')).toBeTruthy()
  })

  it('접힌 디렉토리의 자식은 그리지 않는다', () => {
    const api = tree({
      children: { '': [dir('src')], src: [file('index.ts', 'src/index.ts')] },
    })
    render(<FileTree tree={api} onOpenFile={() => {}} onPickFile={() => {}} />)

    expect(screen.queryByText('index.ts')).toBeNull()
  })

  // 아직 못 읽은 것을 빈 폴더로 보여주면 파일이 없다고 오해한다
  it('읽는 중인 디렉토리는 빈 폴더로 보이지 않는다', () => {
    const api = tree({
      children: { '': [dir('src')] },
      expanded: new Set(['src']),
      loading: new Set(['src']),
    })
    render(<FileTree tree={api} onOpenFile={() => {}} onPickFile={() => {}} />)

    expect(screen.getByText('…')).toBeTruthy()
  })

  it('디렉토리만 펼침 상태를 알린다', () => {
    const api = tree({ children: { '': [dir('src'), file('a.ts')] } })
    render(<FileTree tree={api} onOpenFile={() => {}} onPickFile={() => {}} />)

    const [directory, plain] = screen.getAllByRole('treeitem')
    expect(directory!.getAttribute('aria-expanded')).toBe('false')
    expect(plain!.getAttribute('aria-expanded')).toBeNull()
  })
})
