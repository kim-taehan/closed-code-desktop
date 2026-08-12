// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// ⌘↑/⌘↓ 는 셸 칸 것이다 (`useShortcuts`). 이 파일은 **편집기가 그 키로 커서를 옮기지
// 않는다**는 것 하나를 겨눈다 — 안 삼키면 커서가 문서 끝으로 뛰면서 동시에 칸이 열린다
// (`CodeEditor.tsx` 의 `SHELL_DRAWER_KEYS` 머리말).
//
// ⚠️ **파일을 따로 둔 이유가 이 테스트의 핵심이다.**
//
// CodeMirror 는 `browser.mac` 을 **모듈이 로드될 때** `navigator.platform` 으로 굳히고
// (`@codemirror/view` 의 `mac: ios || /Mac/.test(nav.platform)`), mac 이 아니면
// `Cmd-ArrowUp/Down` 바인딩을 **아예 안 건다.** jsdom 의 `navigator.platform` 은 빈 문자열이라
// 그냥 두면 **고치기 전에도 커서가 안 움직인다** — 즉 이 검사가 헛초록이 된다.
// (실제로 한 번 그렇게 짰다가 기준선을 재서 잡았다: 고치기 전 head=0, 고친 뒤 head=0.)
//
// 그래서 mac 을 흉내 낸 **뒤에** 모듈을 불러온다. 기준선을 확인해 두면:
//   platform=MacIntel + defaultKeymap 만  → ⌘↓ 로 head 0 → 7 (문서 끝)
//   여기에 SHELL_DRAWER_KEYS 를 얹으면    → head 0 그대로
// 정적 import 를 섞으면 `vi.resetModules()` 뒤에 React 가 두 벌이 되므로 전부 동적으로 받는다.

beforeAll(() => {
  Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true })
  vi.resetModules()
})

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react')
  cleanup()
})

/** mac 으로 굳은 모듈들을 받아 편집기를 세운다 */
async function mount(doc: string) {
  const { render } = await import('@testing-library/react')
  const { EditorView } = await import('@codemirror/view')
  const { CodeEditor } = await import('./CodeEditor')

  const { container } = render(<CodeEditor path="a.ts" value={doc} onChange={() => {}} />)
  const host = container.querySelector('.cm-editor') as HTMLElement
  return { view: EditorView.findFromDOM(host)!, content: container.querySelector('.cm-content')! }
}

function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe('편집기에서의 셸 칸 단축키', () => {
  // 이 케이스가 기준선을 함께 지킨다 — 흉내가 안 먹으면 아래 검사들이 헛초록이 되므로,
  // **고치기 전 동작이 실제로 재현되는지**를 먼저 못 박는다.
  it('(기준선) mac 흉내가 먹어서 CodeMirror 가 ⌘↓ 를 바인딩한다', async () => {
    const { defaultKeymap } = await import('@codemirror/commands')
    const { EditorState } = await import('@codemirror/state')
    const { EditorView, keymap } = await import('@codemirror/view')

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const bare = new EditorView({
      parent,
      state: EditorState.create({ doc: '1\n2\n3\n4', extensions: [keymap.of(defaultKeymap)] }),
    })
    press(bare.contentDOM, { key: 'ArrowDown', metaKey: true })
    const head = bare.state.selection.main.head

    // **반드시 destroy 한다.** 안 하면 CodeMirror 가 걸어 둔 measure(rAF)가 나중에 돌고,
    // jsdom 에는 레이아웃이 없어 `getClientRects is not a function` 이 처리 안 된 예외로
    // 뜬다 — 케이스는 전부 초록인데 `npm test` 가 exit 1 이 된다 (실제로 겪었다).
    bare.destroy()
    parent.remove()

    expect(head).toBe(7)
  })

  it('⌘↓ 를 눌러도 커서가 문서 끝으로 뛰지 않는다', async () => {
    const { view, content } = await mount('1\n2\n3\n4')
    press(content, { key: 'ArrowDown', metaKey: true })
    expect(view.state.selection.main.head).toBe(0)
  })

  it('⌘↑ 도 커서를 안 옮긴다', async () => {
    const { view, content } = await mount('1\n2\n3\n4')
    view.dispatch({ selection: { anchor: 5 } })
    press(content, { key: 'ArrowUp', metaKey: true })
    expect(view.state.selection.main.head).toBe(5)
  })

  // 삼키되 **막지는 않는다** — window 까지 올라가야 `useShortcuts` 가 칸을 연다.
  // 여기서 stopPropagation 을 하면 편집기 탭에서만 셸 칸이 안 열린다.
  it('이벤트는 창까지 올라간다 — 안 그러면 편집기에서 칸이 안 열린다', async () => {
    const { content } = await mount('1\n2')
    const seen = vi.fn()
    window.addEventListener('keydown', seen)
    press(content, { key: 'ArrowDown', metaKey: true })
    window.removeEventListener('keydown', seen)

    expect(seen).toHaveBeenCalled()
  })

  // ⇧ 가 끼면 선택 영역 넓히기다. 셸 칸은 그 조합을 광고한 적이 없고,
  // `useShortcuts` 쪽도 ⇧ 가 끼면 손대지 않는다.
  it('⌘⇧↓ 는 그대로 선택을 문서 끝까지 넓힌다', async () => {
    const { view, content } = await mount('1\n2\n3\n4')
    press(content, { key: 'ArrowDown', metaKey: true, shiftKey: true })
    expect(view.state.selection.main.head).toBe(view.state.doc.length)
  })
})
