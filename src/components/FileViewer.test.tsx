// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileViewer } from './FileViewer'
import { MainTabs } from './MainTabs'
import type { OpenFile } from '../state/useOpenFiles'

afterEach(cleanup)

// 편집 콜백은 대부분의 테스트에서 쓰지 않는다 — no-op 으로 채운다.
function renderFile(file: OpenFile, props: Partial<Parameters<typeof FileViewer>[0]> = {}) {
  return render(<FileViewer file={file} onEdit={() => {}} onFlush={() => {}} {...props} />)
}

describe('파일 뷰어', () => {
  it('내용을 보여준다', () => {
    const { container } = renderFile({ path: 'a.ts', text: 'const x = 1' })
    expect(container.querySelector('.cm-content')?.textContent).toBe('const x = 1')
  })

  it('못 읽었으면 사유를 보여준다 — 왜 안 열리는지 알아야 한다', () => {
    renderFile({ path: 'a.bin', text: '', error: '텍스트 파일이 아닙니다' })
    expect(screen.getByText('텍스트 파일이 아닙니다')).toBeTruthy()
  })

  // 빈 파일이라고 안내문만 띄우면 거기다 쓸 수가 없다
  it('빈 파일도 바로 칠 수 있다', () => {
    const { container } = renderFile({ path: 'a.ts', text: '' })
    expect(container.querySelector('.cm-editor')).toBeTruthy()
  })

  // 턴 리뷰에서 변경 위치로 열었을 때
  it('갈 줄이 있으면 그 줄로 간다', () => {
    const { container } = renderFile({ path: 'a.ts', text: '1\n2\n3', revealLine: 3 })
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)

    expect(view?.state.doc.lineAt(view.state.selection.main.head).number).toBe(3)
  })
})

describe('마크다운 미리보기', () => {
  // 문서를 열었으면 읽으려는 것이지 문법을 보려는 게 아니다
  it('md 는 기본이 미리보기다', () => {
    const { container } = renderFile({ path: 'a.md', text: '# 제목' })

    expect(container.querySelector('h1')?.textContent).toBe('제목')
    expect(container.querySelector('pre')).toBeNull()
  })

  it('원문으로 바꾸면 편집기로 보여준다', () => {
    const { container } = renderFile({ path: 'a.md', text: '# 제목' })

    fireEvent.click(screen.getByText('원문'))
    expect(container.querySelector('.cm-content')?.textContent).toBe('# 제목')
  })

  // 미리보기에는 줄 개념이 없어 갈 곳이 없다 (턴 리뷰에서 md 를 변경 위치로 열 때)
  it('갈 줄이 있으면 원문으로 연다', () => {
    const { container } = renderFile({ path: 'a.md', text: '# 제목\n\n본문', revealLine: 3 })

    expect(container.querySelector('.cm-content')).toBeTruthy()
    expect(container.querySelector('.dc-viewer__md')).toBeNull()
  })

  it('그 뒤 미리보기 버튼은 평소대로 먹는다 — 한 번 밀어줄 뿐이다', () => {
    const { container } = renderFile({ path: 'a.md', text: '# 제목\n\n본문', revealLine: 3 })

    fireEvent.click(screen.getByText('미리보기'))
    expect(container.querySelector('h1')?.textContent).toBe('제목')
  })

  it('md 가 아니면 전환 버튼을 그리지 않는다', () => {
    renderFile({ path: 'a.ts', text: 'const x = 1' })
    expect(screen.queryByText('미리보기')).toBeNull()
  })

  it('표도 그린다 (GFM)', () => {
    const table = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    const { container } = renderFile({ path: 'a.md', text: table })

    expect(container.querySelector('table')).toBeTruthy()
  })
})

describe('편집', () => {
  // 열자마자 고칠 수 있어야 한다 — 모드로 들어가는 단계를 두지 않는다
  it('편집·저장 버튼 없이 바로 편집기가 뜬다', () => {
    const { container } = renderFile({ path: 'a.ts', text: 'const x = 1' })

    expect(container.querySelector('.cm-editor')).toBeTruthy()
    expect(screen.queryByText('편집')).toBeNull()
    expect(screen.queryByText('저장')).toBeNull()
    expect(screen.queryByText('되돌리기')).toBeNull()
  })

  it('아직 저장 안 된 내용이 있으면 그걸 보여준다', () => {
    const { container } = renderFile({ path: 'a.ts', text: 'const x = 1', draft: 'const x = 2' })
    expect(container.querySelector('.cm-content')?.textContent).toBe('const x = 2')
  })

  // 미리보기로 확인하면서 고치는 흐름이라 원문만 바뀌면 안 된다
  it('마크다운 미리보기도 고친 내용을 반영한다', () => {
    const { container } = renderFile({ path: 'a.md', text: '# 원본', draft: '# 고침' })
    expect(container.querySelector('h1')?.textContent).toBe('고침')
  })

  it('줄 수는 고친 내용을 센다', () => {
    renderFile({ path: 'a.ts', text: 'a', draft: 'a\nb\nc' })
    expect(screen.getByText('3줄')).toBeTruthy()
  })
})

describe('본문 탭', () => {
  const NOOP = { onSelect: () => {}, onClose: () => {}, logs: false, onCloseLogs: () => {} }

  // 지금 무엇을 보고 있는지가 항상 드러나야 한다
  it('연 파일이 없어도 대화 탭은 보인다', () => {
    render(<MainTabs {...NOOP} files={[]} active="chat" />)

    const chat = screen.getByRole('tab')
    expect(chat.textContent).toBe('대화')
    expect(chat.getAttribute('aria-selected')).toBe('true')
  })

  it('대화와 연 파일을 탭으로 보여준다', () => {
    render(<MainTabs {...NOOP} files={[{ path: 'src/a.ts', text: '' }]} active="chat" />)

    expect(screen.getByText('대화')).toBeTruthy()
    // 탭에는 파일명만 — 전체 경로는 좁은 탭에서 잘린다
    expect(screen.getByText('a.ts')).toBeTruthy()
  })

  it('고르면 알린다', () => {
    const onSelect = vi.fn()
    render(
      <MainTabs {...NOOP} onSelect={onSelect} files={[{ path: 'src/a.ts', text: '' }]} active="chat" />,
    )

    fireEvent.click(screen.getByText('a.ts'))
    expect(onSelect).toHaveBeenCalledWith('src/a.ts')
  })

  it('미저장 편집이 있으면 탭에 표시한다', () => {
    render(
      <MainTabs {...NOOP} files={[{ path: 'src/a.ts', text: 'a', draft: 'b' }]} active="chat" />,
    )
    expect(screen.getByLabelText('저장 안 됨')).toBeTruthy()
  })

  it('로그를 열면 파일과 같은 층의 탭으로 선다', () => {
    render(<MainTabs {...NOOP} logs files={[{ path: 'src/a.ts', text: '' }]} active="logs" />)

    expect(screen.getByText('로그')).toBeTruthy()
    expect(screen.getByText('a.ts')).toBeTruthy()
  })

  it('× 는 고르는 것이 아니라 닫는 것이다', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <MainTabs
        {...NOOP}
        onSelect={onSelect}
        onClose={onClose}
        files={[{ path: 'src/a.ts', text: '' }]}
        active="chat"
      />,
    )

    fireEvent.click(screen.getByTitle('닫기'))
    expect(onClose).toHaveBeenCalledWith('src/a.ts')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
