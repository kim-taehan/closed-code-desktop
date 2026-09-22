// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MainView, type MainViewProps } from './MainView'
import type { OpenFile, OpenFilesApi } from '../state/openFilesTypes'
import { webviewTabKey } from '../state/useOpenWebviewTab'

// 웹뷰 탭은 **탭을 옮겨도 다시 뜨지 않는다** (E4). 본문은 지금 탭 하나만 그리는데(`MainView`),
// 웹뷰만은 열린 동안 늘 그려 두고 CSS 로 감춘다. 이 시험은 그 약속을 **`MainView` 를 통째로** 걸어서
// 본다 — 갈래(로그·다른 웹뷰)가 바뀔 때 iframe 이 DOM 에서 자리를 옮기면 브라우저가 다시 싣는다.
// 그래서 「같은 iframe 원소인가」가 곧 「다시 안 떴나」다.

afterEach(cleanup)

const A = webviewTabKey('ext', 'a')
const B = webviewTabKey('ext', 'b')

function webviewFile(key: string, viewId: string): OpenFile {
  return { path: key, text: '', label: viewId, webview: { extension: 'ext', viewId, projectId: 'P' } }
}

let opens = 0

beforeEach(() => {
  opens = 0
  // jsdom 에 없다 — 로그 갈래가 바닥으로 따라가며 부른다
  Element.prototype.scrollIntoView = () => {}
  ;(window as unknown as { davis: unknown }).davis = {
    openExtensionUi: vi.fn(async ({ viewId }: { viewId: string }) => {
      opens += 1
      return { ok: true, token: `${viewId}-${opens}`, url: `code-ext://ui/${viewId}-${opens}/index.html`, title: viewId }
    }),
    closeExtensionUi: vi.fn(async () => {}),
    sendExtensionUi: vi.fn(async () => {}),
    onExtensionUiMessage: () => () => {},
    listLogs: async () => ({ entries: [] }),
    onLogAppend: () => () => {},
  }
})

function props(files: OpenFile[], active: string): MainViewProps {
  const openFiles = { files, active } as unknown as OpenFilesApi
  return {
    logs: true,
    scm: false,
    openFiles,
    gesture: { handlers: {}, subscribeTrail: () => () => {} },
    toasts: { show: () => {} },
  } as unknown as MainViewProps
}

const frameOf = (container: HTMLElement, key: string) =>
  container.querySelector(`[data-tab='${key}'] iframe`) as HTMLIFrameElement | null

describe('웹뷰 탭 — 탭을 옮겨도 그대로', () => {
  it('로그 탭·다른 웹뷰 탭을 오가도 iframe 원소와 토큰이 그대로다 — 감춰질 뿐이다', async () => {
    const files = [webviewFile(A, 'a'), webviewFile(B, 'b')]
    const view = render(<MainView {...props(files, A)} />)
    await act(async () => {})
    const frameA = frameOf(view.container, A)
    expect(frameA?.getAttribute('src')).toBe('code-ext://ui/a-1/index.html')

    for (const active of ['logs', B, A, 'logs', A]) {
      view.rerender(<MainView {...props(files, active)} />)
      await act(async () => {})
      expect(frameOf(view.container, A)).toBe(frameA)
      const hidden = view.container.querySelector(`[data-tab='${A}']`)?.classList.contains('ext-webview--hidden')
      expect(hidden).toBe(active !== A)
    }
    // 두 탭이 한 번씩만 떴다
    expect(opens).toBe(2)
    expect(frameA?.getAttribute('src')).toBe('code-ext://ui/a-1/index.html')
  })

  it('닫으면 iframe 이 내려지고, 다시 열면 새로 뜬다', async () => {
    const view = render(<MainView {...props([webviewFile(A, 'a')], A)} />)
    await act(async () => {})
    const first = frameOf(view.container, A)

    view.rerender(<MainView {...props([], 'logs')} />)
    await act(async () => {})
    expect(frameOf(view.container, A)).toBeNull()

    view.rerender(<MainView {...props([webviewFile(A, 'a')], A)} />)
    await act(async () => {})
    const again = frameOf(view.container, A)
    expect(again).not.toBeNull()
    expect(again).not.toBe(first)
    expect(again?.getAttribute('src')).toBe('code-ext://ui/a-2/index.html')
  })
})
