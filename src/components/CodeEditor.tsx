import { useEffect, useRef } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { EditorSelection } from '../state/editorContext'

// 파일 편집기. CodeMirror 를 감싼 얇은 겉면이다.
//
// 직접 만든 textarea 를 쓰지 않는 이유: 하이라이팅과 편집을 **동시에** 하려면
// 색칠한 태그 위에 투명 textarea 를 겹쳐야 하는데, 그러면 한글 IME 조합 중인 글자가
// (textarea 자체 색으로 그려져서) 안 보인다. CodeMirror 는 조합을 직접 다뤄 이 문제가 없다.
//
// 색은 대화 코드 블록과 **같은 CSS 변수**를 쓴다 — 테마를 바꾸면 둘이 함께 바뀐다.

export interface CodeEditorProps {
  /** 언어 판별에 쓴다 (확장자) */
  path: string
  value: string
  onChange: (next: string) => void
  /** 포커스를 잃을 때. 자동 저장을 앞당기는 데 쓴다 — 탭을 옮기고 앱을 닫아도 안 잃는다. */
  onBlur?: () => void
  /**
   * 고른 범위가 바뀔 때. **1-based 라인 범위**이고, 커서만 있는(빈) 선택이면 null.
   *
   * 채팅 요청의 `activeEditor.selection` 이 된다 — 여기서 안 내보내면 "이 함수 고쳐줘" 의
   * "이" 가 밖으로 나갈 길이 없다 (editorContext.ts).
   */
  onSelectionChange?: (range: EditorSelection | null) => void
  /** 열자마자 이 줄이 보이게 스크롤한다 (1-indexed). 없으면 맨 위 — 기존 동작. */
  revealLine?: number
}

export function CodeEditor({
  path,
  value,
  onChange,
  onBlur,
  onSelectionChange,
  revealLine,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // 콜백은 렌더마다 새 함수일 수 있다. 뷰는 한 번만 만들고 최신 것만 갈아끼운다.
  const emit = useRef(onChange)
  emit.current = onChange
  const blurred = useRef(onBlur)
  blurred.current = onBlur
  const selected = useRef(onSelectionChange)
  selected.current = onSelectionChange
  // 언어는 나중에 (비동기로) 실려 온다 — 갈아끼울 수 있게 칸을 비워 둔다
  const language = useRef(new Compartment())

  useEffect(() => {
    if (host.current === null) return
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          syntaxHighlighting(HIGHLIGHT),
          language.current.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) emit.current(update.state.doc.toString())
            // 고른 범위가 바뀔 때만 알린다. 커서만 있는 상태는 "고칠 곳" 을 가리킨 게
            // 아니므로 null 로 지운다 — 그대로 보내면 엉뚱한 한 줄이 지목된다.
            if (update.selectionSet) selected.current?.(rangeOf(update.state))
          }),
          EditorView.domEventHandlers({ blur: () => blurred.current?.() }),
        ],
      }),
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // 파일마다 새로 만든다 — 부르는 쪽이 key 로 가른다. value 는 아래 effect 가 따로 맞춘다.
  }, [])

  // 예약된 스크롤 목적지. 파일 내용은 탭이 선 **뒤에** 비동기로 들어오므로
  // (useOpenFiles.open), 빈 문서에 대고 스크롤해봐야 갈 곳이 없다. 예약해 두고
  // 내용이 채워진 뒤에 실행한다.
  const pending = useRef<number | null>(null)

  const reveal = () => {
    const editor = view.current
    const line = pending.current
    if (editor === null || line === null) return
    if (editor.state.doc.length === 0) return // 아직 안 들어왔다 — 다음 기회에
    pending.current = null
    if (line < 1) return
    // 범위 밖이면 끝 줄로 — 못 가는 줄을 요구받았다고 아무 데도 안 가면 더 이상하다
    const at = editor.state.doc.line(Math.min(line, editor.state.doc.lines)).from
    editor.dispatch({
      selection: { anchor: at },
      effects: EditorView.scrollIntoView(at, { y: 'center' }),
    })
  }

  // 밖에서 내용이 바뀌면(파일을 다 읽어 왔을 때) 문서를 맞춘다.
  // 내가 친 글자는 이미 같은 값이라 여기서 걸러진다 — 커서가 튀지 않는다.
  useEffect(() => {
    const editor = view.current
    if (editor === null) return
    if (editor.state.doc.toString() !== value)
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
    reveal()
  }, [value])

  useEffect(() => {
    pending.current = revealLine ?? null
    reveal()
  }, [revealLine])

  // 확장자에 맞는 문법을 실어 온다. 모르는 확장자면 색 없이 평문으로 둔다.
  useEffect(() => {
    let cancelled = false
    const found = LanguageDescription.matchFilename(languages, baseName(path))
    if (found === null) return
    void found.load().then((support) => {
      if (cancelled || view.current === null) return
      view.current.dispatch({ effects: language.current.reconfigure(support) })
    })
    return () => {
      cancelled = true
    }
  }, [path])

  return <div className="dc-viewer__editor" ref={host} />
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

/** 지금 고른 범위를 1-based 라인으로. 빈 선택이면 null. */
function rangeOf(state: EditorState): EditorSelection | null {
  const range = state.selection.main
  if (range.empty) return null
  return {
    startLine: state.doc.lineAt(range.from).number,
    endLine: state.doc.lineAt(range.to).number,
  }
}

/**
 * 문법 색.
 *
 * 대화 코드 블록(highlight.js)이 쓰는 변수를 그대로 쓴다 — 같은 코드가 화면 두 곳에서
 * 다른 색으로 보이면 안 된다. 값이 CSS 변수라 테마 전환은 CSS 가 알아서 한다.
 */
const HIGHLIGHT = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.modifier,
      tags.self,
      tags.null,
      tags.bool,
      tags.atom,
    ],
    color: 'var(--dc-code-keyword)',
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.attributeValue],
    color: 'var(--dc-code-string)',
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: 'var(--dc-text-muted)',
    fontStyle: 'italic',
  },
  {
    tag: [tags.number, tags.integer, tags.float, tags.standard(tags.name), tags.attributeName],
    color: 'var(--dc-code-number)',
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.function(tags.variableName)),
      tags.className,
      tags.typeName,
      tags.tagName,
      tags.heading,
    ],
    color: 'var(--dc-code-title)',
  },
])
