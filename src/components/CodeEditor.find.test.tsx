// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchQuery, findNext, openSearchPanel, setSearchQuery } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import { CodeEditor } from './CodeEditor'

// 파일 안에서 찾기 (⌘F — davis-code-desktop `680678a` 에서 가져왔다).
// 창 전역 ⌘⇧F 는 프로젝트 전체 검색이라 다른 기능이다 — 여기서는 열린 파일 하나를 본다.

afterEach(cleanup)

/** 편집기 DOM 에서 CodeMirror 뷰를 꺼낸다 */
function viewOf(container: HTMLElement): EditorView {
  const dom = container.querySelector<HTMLElement>('.cm-editor')!
  const view = EditorView.findFromDOM(dom)
  expect(view).not.toBeNull()
  return view!
}

describe('파일 안에서 찾기', () => {
  // jsdom 에는 platform 이 없어 CodeMirror 의 `Mod` 가 Ctrl 로 잡힌다 — 실기(맥)에서는 ⌘F 다
  it('Mod+F 로 찾기 패널이 편집기 위에 열린다', () => {
    const { container } = render(<CodeEditor path="a.ts" value={'alpha\nbeta\nalpha'} onChange={() => {}} />)
    const view = viewOf(container)

    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }),
    )

    const panel = container.querySelector('.cm-panels-top .cm-search')
    expect(panel).not.toBeNull()
    expect(panel!.querySelector('input')).not.toBeNull()
  })

  it('찾은 글자로 커서가 간다', () => {
    const { container } = render(<CodeEditor path="a.ts" value={'alpha\nbeta\nalpha'} onChange={() => {}} />)
    const view = viewOf(container)
    openSearchPanel(view)
    // 패널 입력칸에서 Enter 로 확정하는 길은 jsdom 이 레이아웃을 재지 못해 막힌다 — 같은 명령을 직접 부른다
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'beta' })) })
    findNext(view)

    const { from, to } = view.state.selection.main
    expect(view.state.doc.sliceString(from, to)).toBe('beta')
  })

  it('Esc 로 패널이 닫힌다 — 전역 Esc(응답 중단)와 겹치지 않게 패널이 먼저 먹는다', () => {
    const { container } = render(<CodeEditor path="a.ts" value="alpha" onChange={() => {}} />)
    const view = viewOf(container)
    openSearchPanel(view)
    expect(container.querySelector('.cm-search')).not.toBeNull()

    const input = container.querySelector<HTMLInputElement>('.cm-search input[name="search"]')!
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(container.querySelector('.cm-search')).toBeNull()
  })

  it('편집기가 없는 곳에서는 ⌘F 를 가로채지 않는다 — 전역 단축키(⌘⇧F)와 겹치지 않는다', () => {
    const seen = vi.fn()
    window.addEventListener('keydown', seen)
    render(<CodeEditor path="a.ts" value="alpha" onChange={() => {}} />)

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true }),
    )

    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0]![0].defaultPrevented).toBe(false)
    window.removeEventListener('keydown', seen)
  })
})
