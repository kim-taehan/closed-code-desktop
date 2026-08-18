// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileTree } from './FileTree'
import type { FileTreeApi } from '../state/useFileTree'
import type { DirEntryPayload } from '../../shared/ipc/channels'

// 화살표 조작의 **배선**. 무엇이 답인가는 순수 판단이 지고(`state/fileTreeKeys.test.ts`),
// 여기서는 그 답이 실제로 **초점을 옮기고 명령을 부르는가**를 본다.
//
// 층이 잠겼는지와 층 사이가 이어졌는지는 다른 질문이다 — 판단만 잠그면 화면이 그 답을
// 안 쓰는 자리를 못 잡는다.

afterEach(cleanup)

function dir(name: string, path = name): DirEntryPayload {
  return { name, path, isDirectory: true }
}

function file(name: string, path = name): DirEntryPayload {
  return { name, path, isDirectory: false }
}

function tree(overrides: Partial<FileTreeApi> = {}): FileTreeApi {
  return { children: {}, expanded: new Set(), loading: new Set(), toggle: () => {}, refresh: () => {}, ...overrides }
}

/**   src/ (펼침) → a.ts · b.ts,  README.md */
function draw(overrides: { toggle?: (path: string) => void; onOpenFile?: (path: string) => void } = {}) {
  const api = tree({
    children: {
      '': [dir('src'), file('README.md')],
      src: [file('a.ts', 'src/a.ts'), file('b.ts', 'src/b.ts')],
    },
    expanded: new Set(['src']),
    ...(overrides.toggle ? { toggle: overrides.toggle } : {}),
  })
  const view = render(
    <FileTree tree={api} onOpenFile={overrides.onOpenFile ?? (() => {})} onPickFile={() => {}} />,
  )
  return { ...view, treeEl: view.container.querySelector('.dc-tree') as HTMLElement }
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest('button') as HTMLElement
}

/**
 * 그 줄에 초점을 준다.
 *
 * **`act` 로 감싼다** — 줄의 `onFocus` 가 `setActive` 를 부르는데, 밖에서 부르면 그 상태가
 * 다음 단언 전에 안 흐른다. 그러면 화살표가 「초점 없음」에서 계산돼 시험이 통째로 어긋난다.
 */
function focusRow(name: string): void {
  act(() => rowOf(name).focus())
}

describe('초점은 트리에서 한 줄만 갖는다', () => {
  // 줄마다 tab 이 서면 903줄짜리 트리에서 Tab 한 번에 사이드바를 못 빠져나간다.
  it('맨 위 한 줄만 0 이고 나머지는 -1 이다', () => {
    const { container } = draw()
    const tabs = Array.from(container.querySelectorAll('[role="treeitem"]')).map((one) =>
      one.getAttribute('tabindex'),
    )

    expect(tabs[0]).toBe('0')
    expect(tabs.slice(1).every((one) => one === '-1')).toBe(true)
  })
})

describe('화살표가 초점을 옮긴다', () => {
  it('↓ 를 누르면 다음 줄이 실제로 초점을 받는다 — tabindex 만 옮기면 키보드는 그 자리에 남는다', () => {
    const { treeEl } = draw()
    focusRow('src')

    fireEvent.keyDown(treeEl, { key: 'ArrowDown' })

    expect(document.activeElement).toBe(rowOf('a.ts'))
  })

  it('← 로 파일에서 부모 폴더로 올라간다', () => {
    const { treeEl } = draw()
    focusRow('b.ts')

    fireEvent.keyDown(treeEl, { key: 'ArrowLeft' })

    expect(document.activeElement).toBe(rowOf('src'))
  })

  it('→ 로 펼친 폴더의 첫 자식에 들어간다', () => {
    const { treeEl } = draw()
    focusRow('src')

    fireEvent.keyDown(treeEl, { key: 'ArrowRight' })

    expect(document.activeElement).toBe(rowOf('a.ts'))
  })
})

describe('펼치고 접는 것은 한쪽으로만 간다', () => {
  it('← 는 펼친 폴더를 접는다', () => {
    const toggle = vi.fn()
    const { treeEl } = draw({ toggle })
    focusRow('src')

    fireEvent.keyDown(treeEl, { key: 'ArrowLeft' })

    expect(toggle).toHaveBeenCalledWith('src')
  })

  // 이미 펼친 폴더에 → 를 걸면 자식으로 갈 뿐 접히면 안 된다. 뒤집기 하나로 두면
  // 자식이 없는 폴더에서 방향키가 반대로 돈다.
  it('→ 는 이미 펼친 폴더를 접지 않는다', () => {
    const toggle = vi.fn()
    const { treeEl } = draw({ toggle })
    focusRow('src')

    fireEvent.keyDown(treeEl, { key: 'ArrowRight' })

    expect(toggle).not.toHaveBeenCalled()
  })
})

describe('Enter 는 누른 것과 같다', () => {
  it('파일에서는 연다', () => {
    const onOpenFile = vi.fn()
    const { treeEl } = draw({ onOpenFile })
    focusRow('a.ts')

    fireEvent.keyDown(treeEl, { key: 'Enter' })

    expect(onOpenFile).toHaveBeenCalledWith('src/a.ts')
  })
})

describe('우리 것이 아닌 키는 흘려보낸다', () => {
  // 다 삼키면 트리 안에서 Tab 도 글자 입력도 죽는다.
  it('Tab 은 막지 않는다', () => {
    const { treeEl } = draw()
    focusRow('src')

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    treeEl.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  // ⌘↑/⌘↓ 는 셸 칸 것이다 (`CodeEditor.tsx` 의 `SHELL_DRAWER_KEYS` 와 같은 경계).
  it('조합키가 끼면 손대지 않는다', () => {
    const { treeEl } = draw()
    focusRow('src')

    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', metaKey: true, bubbles: true, cancelable: true })
    treeEl.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(rowOf('src'))
  })
})
