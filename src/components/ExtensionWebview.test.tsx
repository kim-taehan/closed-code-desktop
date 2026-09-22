// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionWebview } from './ExtensionWebview'
import { APP_REJECTED_MESSAGE, APP_THEME_MESSAGE, UI_MESSAGE_MAX_BYTES } from '../../shared/extensions/uiMessage'
import type { ExtensionUiMessagePayload, ExtensionUiTarget } from '../../shared/ipc/extensionUiBridge'

// 웹뷰 탭 하나 — 토큰에서 iframe 까지 (E2·E3·E6).
//
// 어느 토큰으로 가는지는 main 이 고르고 `webviewRuntime.test.ts` 가 본다. 여기서는 **받는 탭이 한 번 더
// 거르는가**, 그리고 앞단 쪽 두 약속 — 문서는 한 번만 뜬다 · `load` 전에 온 것은 붙잡아 둔다 — 을 본다.

afterEach(cleanup)

const TARGET: ExtensionUiTarget = { extension: 'webview-fixture', viewId: 'board', projectId: 'P' }

function stubBridge(options: { fail?: string; sendError?: string } = {}) {
  let next = 0
  const listeners = new Set<(payload: ExtensionUiMessagePayload) => void>()
  const bridge = {
    openExtensionUi: vi.fn(async (_target: ExtensionUiTarget) => {
      if (options.fail !== undefined) return { ok: false as const, reason: options.fail }
      next += 1
      return { ok: true as const, token: `t${next}`, url: `code-ext://ui/t${next}/index.html`, title: '보드' }
    }),
    closeExtensionUi: vi.fn(async () => {}),
    sendExtensionUi: vi.fn(async () => {
      if (options.sendError !== undefined) throw new Error(options.sendError)
    }),
    onExtensionUiMessage: (handler: (payload: ExtensionUiMessagePayload) => void) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
  ;(window as unknown as { davis: unknown }).davis = bridge
  const push = (token: string, message: unknown) => act(() => listeners.forEach((listener) => listener({ token, message })))
  return { bridge, push }
}

async function mount(target: ExtensionUiTarget = TARGET) {
  const view = render(<ExtensionWebview target={target} />)
  await act(async () => {})
  const frame = view.container.querySelector('iframe') as HTMLIFrameElement
  const posted = vi.spyOn(frame.contentWindow as Window, 'postMessage')
  return { view, frame, posted }
}

/** 앞단이 보낸 것처럼 부모 창에 던진다. `source` 가 검사의 유일한 근거다 */
function fromFrame(source: Window | null, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, source }))
}

const sentData = (posted: ReturnType<typeof vi.spyOn>) => posted.mock.calls.map((call) => call[0])

describe('문서는 탭이 열릴 때 한 번 뜬다', () => {
  it('sandbox 는 allow-scripts 만, src 는 토큰 URL 이다', async () => {
    stubBridge()
    const { frame } = await mount()
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('src')).toBe('code-ext://ui/t1/index.html')
  })

  it('메시지가 오고 테마가 바뀌고 다시 그려져도 토큰·iframe 이 그대로다', async () => {
    const { bridge, push } = stubBridge()
    const { view, frame } = await mount()
    fireEvent.load(frame)

    push('t1', { rows: [1, 2] })
    act(() => document.documentElement.setAttribute('data-theme', 'light'))
    view.rerender(<ExtensionWebview target={{ ...TARGET }} />)
    await act(async () => {})

    expect(bridge.openExtensionUi).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('iframe')).toBe(frame)
    expect(frame.getAttribute('src')).toBe('code-ext://ui/t1/index.html')
  })

  it('내려지면 토큰을 놓는다', async () => {
    const { bridge } = stubBridge()
    const { view } = await mount()
    view.unmount()
    expect(bridge.closeExtensionUi).toHaveBeenCalledWith({ token: 't1' })
  })

  it('못 띄우면 사유를 그린다 — 빈 화면으로 두지 않는다', async () => {
    stubBridge({ fail: '이 프로젝트에서 켜지 않은 확장입니다' })
    const view = render(<ExtensionWebview target={TARGET} />)
    await act(async () => {})
    expect(view.container.textContent).toContain('이 프로젝트에서 켜지 않은 확장입니다')
    expect(view.container.querySelector('iframe')).toBeNull()
  })
})

describe('뒷단 → 앞단', () => {
  it('load 전에 온 것은 붙잡아 두고, load 때 테마 다음에 순서대로 내보낸다', async () => {
    const { push } = stubBridge()
    const { frame, posted } = await mount()

    push('t1', { n: 1 })
    push('t1', { n: 2 })
    expect(posted).not.toHaveBeenCalled()

    fireEvent.load(frame)
    const sent = sentData(posted)
    expect(sent[0]).toMatchObject({ type: APP_THEME_MESSAGE, vars: expect.objectContaining({ '--app-bg': expect.any(String) }) })
    expect(sent.slice(1)).toEqual([{ n: 1 }, { n: 2 }])
  })

  it('**토큰을 받기 전에** 온 것도 잃지 않는다 — 실 Electron 에서 push 가 답보다 먼저 왔다', async () => {
    const { bridge, push } = stubBridge()
    // 답을 붙잡아 두고, 그 사이에 main 이 이 탭(t1)과 남의 탭(t9)으로 민다
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const original = bridge.openExtensionUi.getMockImplementation()!
    bridge.openExtensionUi.mockImplementation(async (target) => {
      await gate
      return original(target)
    })
    const view = render(<ExtensionWebview target={TARGET} />)
    push('t1', { early: true })
    push('t9', { notMine: true })
    await act(async () => release())
    const frame = view.container.querySelector('iframe') as HTMLIFrameElement
    const posted = vi.spyOn(frame.contentWindow as Window, 'postMessage')

    fireEvent.load(frame)

    expect(sentData(posted).slice(1)).toEqual([{ early: true }])
  })

  it('load 뒤에 온 것은 바로 보낸다', async () => {
    const { push } = stubBridge()
    const { frame, posted } = await mount()
    fireEvent.load(frame)
    posted.mockClear()
    push('t1', { n: 3 })
    expect(sentData(posted)).toEqual([{ n: 3 }])
  })

  it('**남의 토큰 것은 받지 않는다** — 같은 확장·뷰가 다른 프로젝트에 열려 있어도', async () => {
    const { push } = stubBridge()
    const p = await mount({ ...TARGET, projectId: 'P' })
    const q = await mount({ ...TARGET, projectId: 'Q' })
    fireEvent.load(p.frame)
    fireEvent.load(q.frame)
    p.posted.mockClear()
    q.posted.mockClear()

    push('t1', { forP: true })

    expect(sentData(p.posted)).toEqual([{ forP: true }])
    expect(q.posted).not.toHaveBeenCalled()
  })

  it('테마를 바꾸면 문서를 다시 띄우지 않고 예약 메시지로만 알린다', async () => {
    const { bridge } = stubBridge()
    const { frame, posted } = await mount()
    fireEvent.load(frame)
    posted.mockClear()

    act(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await act(async () => {})

    expect(sentData(posted)).toEqual([expect.objectContaining({ type: APP_THEME_MESSAGE })])
    expect(bridge.openExtensionUi).toHaveBeenCalledTimes(1)
  })
})

describe('앞단 → 뒷단', () => {
  it('이 iframe 이 보낸 것만 토큰과 함께 올린다', async () => {
    const { bridge } = stubBridge()
    const { frame } = await mount()

    fromFrame(frame.contentWindow, { click: 'a' })
    fromFrame(window, { click: 'forged' })
    fromFrame(null, { click: 'nobody' })

    expect(bridge.sendExtensionUi).toHaveBeenCalledTimes(1)
    expect(bridge.sendExtensionUi).toHaveBeenCalledWith({ token: 't1', message: { click: 'a' } })
  })

  it('1MB 를 넘으면 올리지 않고 앞단에 사유를 돌려준다', async () => {
    const { bridge } = stubBridge()
    const { frame, posted } = await mount()

    fromFrame(frame.contentWindow, 'a'.repeat(UI_MESSAGE_MAX_BYTES))

    expect(bridge.sendExtensionUi).not.toHaveBeenCalled()
    expect(sentData(posted)).toEqual([{ type: APP_REJECTED_MESSAGE, reason: expect.stringContaining('너무 큽니다') }])
  })

  it('뒷단이 거절하면 그 사유를 앞단에 돌려준다', async () => {
    stubBridge({ sendError: '받지 않습니다' })
    const { frame, posted } = await mount()

    fromFrame(frame.contentWindow, { n: 1 })
    await act(async () => {})

    expect(sentData(posted)).toEqual([{ type: APP_REJECTED_MESSAGE, reason: expect.stringContaining('받지 않습니다') }])
  })
})
