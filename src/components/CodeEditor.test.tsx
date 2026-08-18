// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeEditor } from './CodeEditor'

afterEach(cleanup)

describe('코드 편집기', () => {
  it('내용을 그린다', () => {
    const { container } = render(<CodeEditor path="a.ts" value="const x = 1" onChange={() => {}} />)
    expect(container.querySelector('.cm-content')?.textContent).toBe('const x = 1')
  })

  it('줄번호 기둥을 세운다', () => {
    const { container } = render(<CodeEditor path="a.ts" value="a\nb" onChange={() => {}} />)
    expect(container.querySelector('.cm-gutters')).toBeTruthy()
  })

  // 파일은 열자마자 빈 내용으로 탭이 서고, 다 읽은 뒤에 내용이 들어온다
  it('밖에서 내용이 바뀌면 문서를 맞춘다', () => {
    const { container, rerender } = render(
      <CodeEditor path="a.ts" value="" onChange={() => {}} />,
    )
    rerender(<CodeEditor path="a.ts" value="읽어 온 내용" onChange={() => {}} />)

    expect(container.querySelector('.cm-content')?.textContent).toBe('읽어 온 내용')
  })

  it('확장자에 맞는 문법을 실어 온다', async () => {
    const { container } = render(
      <CodeEditor path="a.py" value="def f(): pass" onChange={() => {}} />,
    )
    // 문법이 붙으면 토큰이 span 으로 쪼개진다 (평문일 땐 통짜다)
    await waitFor(() => {
      expect(container.querySelectorAll('.cm-content span').length).toBeGreaterThan(0)
    })
  })

  it('치면 바뀐 내용을 알린다', () => {
    const onChange = vi.fn()
    const { container } = render(<CodeEditor path="a.ts" value="a" onChange={onChange} />)

    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
    view?.dispatch({ changes: { from: 1, insert: 'b' } })

    expect(onChange).toHaveBeenCalledWith('ab')
  })

  // 턴 리뷰에서 파일을 열면 첫 변경 지점으로 간다 (jsdom 은 레이아웃이 없어
  // 스크롤 위치를 못 재므로, 같은 dispatch 로 옮겨 가는 커서를 대리 지표로 본다)
  it('revealLine 을 주면 그 줄로 간다', () => {
    const { container } = render(
      <CodeEditor path="a.ts" value={'1\n2\n3\n4'} onChange={() => {}} revealLine={3} />,
    )
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
    expect(view?.state.doc.lineAt(view.state.selection.main.head).number).toBe(3)
  })

  it('내용이 나중에 들어와도 그 줄로 간다 — 탭이 먼저 서고 파일은 뒤에 읽힌다', () => {
    const { container, rerender } = render(
      <CodeEditor path="a.ts" value="" onChange={() => {}} revealLine={3} />,
    )
    rerender(<CodeEditor path="a.ts" value={'1\n2\n3\n4'} onChange={() => {}} revealLine={3} />)

    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
    expect(view?.state.doc.lineAt(view.state.selection.main.head).number).toBe(3)
  })

  it('revealLine 이 없으면 맨 위 그대로 — 기존 동작', () => {
    const { container } = render(
      <CodeEditor path="a.ts" value={'1\n2\n3\n4'} onChange={() => {}} />,
    )
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
    expect(view?.state.selection.main.head).toBe(0)
  })

  it('범위 밖 줄은 끝 줄로 — 아무 데도 안 가면 더 이상하다', () => {
    const { container } = render(
      <CodeEditor path="a.ts" value={'1\n2'} onChange={() => {}} revealLine={99} />,
    )
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
    expect(view?.state.doc.lineAt(view.state.selection.main.head).number).toBe(2)
  })

  it('글자를 쳐도 다시 끌려가지 않는다 — 한 번 간 뒤로는 커서가 내 것이다', () => {
    const { container, rerender } = render(
      <CodeEditor path="a.ts" value={'1\n2\n3\n4'} onChange={() => {}} revealLine={3} />,
    )
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
    view?.dispatch({ selection: { anchor: 0 } })
    rerender(
      <CodeEditor path="a.ts" value={'x\n1\n2\n3\n4'} onChange={() => {}} revealLine={3} />,
    )

    expect(view?.state.selection.main.head).toBe(0)
  })

  // 🔒 좌표계 잠금. main 도 runtime 도 이 값을 **검증 없이 통과**시키고(runtime 은 `ge=0` 만
  // 본다), 타입으로는 절대 안 잡힌다. 0-based 를 흘리면 에러 없이 한 줄씩 어긋난 코드를
  // 가리키게 되므로, 값이 눈에 보이는 단언으로 잠근다.
  //
  // 두 좌표계가 한 화면에 있다: CodeMirror 의 **위치(offset)는 0-based**,
  // `doc.lineAt(pos).number` 가 주는 **라인은 1-based**. 우리가 뽑는 것은 후자다.
  it('첫 줄을 고르면 startLine 이 1 이다 — 0 이 아니다', () => {
    const onSelectionChange = vi.fn()
    const { container } = render(
      <CodeEditor
        path="a.ts"
        value={'가\n나\n다'}
        onChange={() => {}}
        onSelectionChange={onSelectionChange}
      />,
    )
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
    // 문서 맨 앞 한 글자 — 첫 줄 안에서만 고른다
    view?.dispatch({ selection: { anchor: 0, head: 1 } })

    // 뽑아낸 쪽: 1-based 라인
    expect(onSelectionChange).toHaveBeenCalledWith({ startLine: 1, endLine: 1 })
    // 뽑아 온 원본: 같은 선택의 offset 은 0 에서 시작한다 (그대로 보내면 안 되는 값)
    expect(view?.state.selection.main.from).toBe(0)
  })

  // 채팅에 실을 activeEditor.selection 의 원천. **라인 번호**여야 한다 — 문자 오프셋을
  // 넣으면 runtime 이 그 숫자를 라인으로 읽어 엉뚱한 곳을 지목한다 (message_builder.py:18-32).
  it('범위를 고르면 1-based 라인으로 알린다', () => {
    const onSelectionChange = vi.fn()
    const { container } = render(
      <CodeEditor
        path="a.ts"
        value={'가\n나\n다\n라'}
        onChange={() => {}}
        onSelectionChange={onSelectionChange}
      />,
    )
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
    // 2번째 줄 첫 글자 ~ 3번째 줄 첫 글자 (문자 오프셋 2..4)
    view?.dispatch({ selection: { anchor: 2, head: 4 } })

    expect(onSelectionChange).toHaveBeenCalledWith({ startLine: 2, endLine: 3 })
  })

  it('커서만 있으면 null — 고른 곳이 없는데 한 줄을 지목하면 안 된다', () => {
    const onSelectionChange = vi.fn()
    const { container } = render(
      <CodeEditor
        path="a.ts"
        value={'가\n나\n다'}
        onChange={() => {}}
        onSelectionChange={onSelectionChange}
      />,
    )
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
    view?.dispatch({ selection: { anchor: 2, head: 4 } })
    view?.dispatch({ selection: { anchor: 3 } })

    expect(onSelectionChange).toHaveBeenLastCalledWith(null)
  })

  it('내용만 바뀌는 것으로는 알리지 않는다 — 기존 docChanged 경로는 그대로다', () => {
    const onChange = vi.fn()
    const onSelectionChange = vi.fn()
    const { container, rerender } = render(
      <CodeEditor
        path="a.ts"
        value=""
        onChange={onChange}
        onSelectionChange={onSelectionChange}
      />,
    )
    // 밖에서 내용이 들어오는 경로 (파일을 다 읽어 왔을 때)
    rerender(
      <CodeEditor
        path="a.ts"
        value="읽어 온 내용"
        onChange={onChange}
        onSelectionChange={onSelectionChange}
      />,
    )

    expect(container.querySelector('.cm-content')?.textContent).toBe('읽어 온 내용')
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  it('포커스를 잃으면 알린다 — 자동 저장을 앞당긴다', () => {
    const onBlur = vi.fn()
    const { container } = render(
      <CodeEditor path="a.ts" value="a" onChange={() => {}} onBlur={onBlur} />,
    )

    container.querySelector('.cm-content')?.dispatchEvent(new FocusEvent('blur'))
    expect(onBlur).toHaveBeenCalled()
  })
})

// **되돌리기는 사람이 친 것만 되돌린다.**
//
// 편집기는 `doc: ''` 로 태어나고 파일은 비동기로 뒤에 온다 (`useOpenFiles.open`). 그래서
// 「파일 내용이 들어가는 순간」이 트랜잭션 하나가 되는데, 그것이 이력에 쌓여 있었다 —
// ⌘Z 를 충분히 누르면 그 채움까지 되돌아가 **문서가 통째로 빈다.** 거기서 끝나지 않는다:
// 빈 문서가 `onChange` 로 나가 draft 가 되고 600ms 뒤 자동 저장이 빈 파일을 디스크에 쓴다.
// 실측(2026-08-18) — `gateway/gradlew.bat` 2,896바이트가 0바이트가 됐다.
describe('되돌리기의 바닥은 파일을 연 시점이다', () => {
  /** 열림(빈 문서) → 내용 도착, 실제 흐름 그대로 */
  function opened(text: string, onChange: (next: string) => void = () => {}) {
    const view = render(<CodeEditor path="a.ts" value="" onChange={onChange} />)
    view.rerender(<CodeEditor path="a.ts" value={text} onChange={onChange} />)
    const editor = EditorView.findFromDOM(view.container.querySelector('.cm-editor') as HTMLElement)
    return { ...view, editor: editor as EditorView }
  }

  /** ⌘Z 를 열 번. 사람이 「다 지워질 때까지」 누르는 모양이다 */
  function undoTimes(editor: EditorView, times: number) {
    for (let at = 0; at < times; at += 1) undo({ state: editor.state, dispatch: editor.dispatch })
  }

  it('아무것도 안 쳤으면 ⌘Z 를 아무리 눌러도 내용이 그대로다', () => {
    const { container, editor } = opened('원래 내용')

    undoTimes(editor, 10)

    expect(container.querySelector('.cm-content')?.textContent).toBe('원래 내용')
  })

  it('친 것은 되돌아가되 **연 시점에서 멈춘다** — 파일이 비지 않는다', () => {
    const { container, editor } = opened('원래 내용')
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: ' 더 씀' } })
    expect(container.querySelector('.cm-content')?.textContent).toBe('원래 내용 더 씀')

    undoTimes(editor, 10)

    expect(container.querySelector('.cm-content')?.textContent).toBe('원래 내용')
  })

  // 빈 문서가 밖으로 나가면 그것이 draft 가 되고 자동 저장이 디스크를 비운다.
  // 화면이 잠깐 비었다 돌아오는 정도가 아니라 **파일이 사라지는** 자리다.
  it('되돌리기가 빈 내용을 밖으로 내보내지 않는다', () => {
    const seen: string[] = []
    const { editor } = opened('원래 내용', (next) => seen.push(next))
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: 'x' } })

    undoTimes(editor, 10)

    expect(seen).not.toContain('')
  })
})
