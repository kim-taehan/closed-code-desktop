// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionHtmlView } from './ExtensionHtmlView'
import { EXTENSION_COMMAND_MESSAGE, EXTENSION_OPEN_MESSAGE } from '../state/extensionHtmlDoc'

// 확장 화면의 **울타리**를 잠근다.
//
// 문서를 어떻게 조립하는가는 `state/extensionHtmlDoc.test.ts` 가 본다. 여기서 보는 것은
// **그 문서를 화면에 붙이는 쪽** 이다 — 조립이 아무리 엄격해도 붙이는 자리에서 새면 소용없다.
// 확장 호스트(자식)는 애초에 샌드박스가 아니므로(`docs/reference/extension-standard.md` §3)
// 화면 격리가 남은 방어의 상당 부분이다.
//
// 잠그는 것 셋:
//  1. iframe 이 `allow-same-origin` 없이 뜬다 — 있으면 확장 문서가 앱 오리진을 얻는다
//  2. 문서가 `srcdoc` 이 아니라 `code-ext://` URL 로 실린다 — `srcdoc` 은 앱 CSP 를 물려받아
//     문서가 적은 정책이 통째로 무시된다 (`extensionHtmlDoc.ts` 머리말의 실측)
//  3. 중계되는 것은 **이 iframe 이 보낸 규약 둘뿐** 이다

afterEach(cleanup)

interface Registered {
  docs: string[]
  register: ReturnType<typeof vi.fn>
}

/** main 의 문서 등록을 흉내 낸다. 부를 때마다 새 URL 을 주는 것까지 실물과 같다 */
function stubRegister(fail?: string): Registered {
  const docs: string[] = []
  const register = vi.fn(({ doc }: { doc: string }) => {
    if (fail !== undefined) return Promise.reject(new Error(fail))
    docs.push(doc)
    return Promise.resolve({ url: `code-ext://view/${docs.length}` })
  })
  ;(window as unknown as { davis: unknown }).davis = { registerExtensionView: register }
  return { docs, register }
}

/** 등록 약속이 풀린 뒤의 iframe. 풀기 전에는 「준비 중」이라 iframe 자체가 없다 */
async function mount(props: Partial<Parameters<typeof ExtensionHtmlView>[0]> = {}) {
  const onOpen = vi.fn()
  const onCommand = vi.fn()
  const view = render(
    <ExtensionHtmlView html="<p>hi</p>" onOpen={onOpen} onCommand={onCommand} {...props} />,
  )
  await act(async () => {})
  // **문서 전체가 아니라 이 화면 안에서 찾는다** — 시험이 부러 만든 남의 프레임과 섞이면
  // 「남이 보낸 것을 버린다」가 자기 프레임을 남으로 착각해 통과할 수 있다
  const frame = view.container.querySelector('iframe')
  return { view, frame, onOpen, onCommand }
}

/** 확장 화면이 보낸 것처럼 부모 창에 던진다. `source` 가 검사의 유일한 근거다 */
function post(source: Window | null, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, source }))
}

const OPEN = { type: EXTENSION_OPEN_MESSAGE, path: 'src/App.tsx', line: 12 }
const COMMAND = { type: EXTENSION_COMMAND_MESSAGE, commandId: 'sampleExt.run', target: 'src/App.tsx' }

describe('iframe 울타리', () => {
  it('`allow-same-origin` 없이 스크립트만 허용한다 — 둘을 같이 주면 샌드박스가 무의미해진다', async () => {
    stubRegister()

    const { frame } = await mount()

    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    // 값 전체 비교가 이미 막지만, 무엇을 겨누는지 남긴다: 이 낱말이 들어오면 opaque origin 이
    // 풀리고 확장 문서가 앱 DOM·`window.davis` 에 닿는다
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin')
  })

  it('문서를 `srcdoc` 이 아니라 `code-ext://` URL 로 싣는다 — srcdoc 은 앱 CSP 를 물려받는다', async () => {
    const { docs } = stubRegister()

    const { frame } = await mount()

    expect(frame?.getAttribute('src')).toBe('code-ext://view/1')
    expect(frame?.hasAttribute('srcdoc')).toBe(false)
    // 문서는 main 으로 갔지 DOM 에 실리지 않았다
    expect(docs).toHaveLength(1)
    expect(docs[0]).toContain('<p>hi</p>')
  })

  it('내용이 바뀌면 새 URL 을 받는다 — 같은 URL 이면 캐시된 옛 화면이 그대로 남는다', async () => {
    const { register } = stubRegister()
    const { view, frame } = await mount()
    expect(frame?.getAttribute('src')).toBe('code-ext://view/1')

    view.rerender(<ExtensionHtmlView html="<p>bye</p>" onOpen={() => {}} />)
    await act(async () => {})

    expect(register).toHaveBeenCalledTimes(2)
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('code-ext://view/2')
  })

  it('등록에 실패하면 사유를 보여준다 — 빈 화면은 「확장이 아무것도 안 냈다」와 구분되지 않는다', async () => {
    stubRegister('스킴이 없다')

    const { view } = await mount()

    expect(document.querySelector('iframe')).toBeNull()
    expect(view.container.textContent).toContain('스킴이 없다')
  })
})

describe('메시지 중계', () => {
  it('이 iframe 이 보낸 열기 요청을 올린다', async () => {
    stubRegister()
    const { frame, onOpen } = await mount()

    post(frame!.contentWindow, OPEN)

    expect(onOpen).toHaveBeenCalledWith('src/App.tsx', 12)
  })

  it('이 iframe 이 보낸 명령 요청을 대상과 함께 올린다', async () => {
    stubRegister()
    const { frame, onCommand } = await mount()

    post(frame!.contentWindow, COMMAND)

    expect(onCommand).toHaveBeenCalledWith('sampleExt.run', 'src/App.tsx')
  })

  it('**다른 프레임이 보낸 것은 모양이 같아도 버린다** — 확장끼리 서로의 화면을 조종하지 못한다', async () => {
    stubRegister()
    const { frame, onOpen, onCommand } = await mount()
    const other = document.createElement('iframe')
    document.body.append(other)
    // 같은 규약, 같은 모양. 다른 것은 보낸 창뿐이다.
    // **두 창을 `toBe` 로 비교하지 않는다** — 어긋났을 때 vitest 가 Window 를 훑다가
    // 확장 프레임의 `localStorage` 에 닿고, 그것이 opaque origin 이라 SecurityError 로 죽는다
    // (jsdom 이 샌드박스를 실제로 지킨다는 방증이기도 하다). 참·거짓만 본다
    expect(other.contentWindow === frame!.contentWindow).toBe(false)

    post(other.contentWindow, OPEN)
    post(other.contentWindow, COMMAND)
    other.remove()

    expect(onOpen).not.toHaveBeenCalled()
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('보낸 창이 없는 메시지도 버린다 — 확장 문서는 opaque origin 이라 `source` 가 유일한 근거다', async () => {
    stubRegister()
    const { onOpen } = await mount()

    post(null, OPEN)

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('규약 둘이 아닌 것은 이 iframe 이 보냈어도 버린다', async () => {
    stubRegister()
    const { frame, onOpen, onCommand } = await mount()

    post(frame!.contentWindow, { type: 'code:extension-view-eval', code: 'process.exit(0)' })
    post(frame!.contentWindow, { path: 'src/App.tsx' }) // 표식 없는 열기
    post(frame!.contentWindow, { type: EXTENSION_OPEN_MESSAGE, path: '' })
    post(frame!.contentWindow, { type: EXTENSION_COMMAND_MESSAGE, commandId: 'x', target: { evil: 1 } })
    post(frame!.contentWindow, 'code:extension-view-open')

    expect(onOpen).not.toHaveBeenCalled()
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('명령 받는 이가 없어도 열기는 살아 있다 — `onCommand` 는 선택이다', async () => {
    stubRegister()
    const { frame, onOpen } = await mount({ onCommand: undefined })

    post(frame!.contentWindow, COMMAND)
    post(frame!.contentWindow, OPEN)

    expect(onOpen).toHaveBeenCalledWith('src/App.tsx', 12)
  })

  it('화면을 닫으면 더 안 받는다 — 남은 청취자가 죽은 탭의 요청을 살려 낸다', async () => {
    stubRegister()
    const { view, frame, onOpen } = await mount()
    const source = frame!.contentWindow

    view.unmount()
    post(source, OPEN)

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('받는 이가 바뀌면 옛 것은 더 안 불린다 — 정리를 빠뜨리면 한 번 누른 것이 두 번 열린다', async () => {
    // **위 언마운트 시험은 정리 누락을 못 잡는다** (돌연변이로 확인): 언마운트하면 React 가
    // ref 를 비워 `frame.current?.contentWindow` 가 undefined 가 되고, **보낸 창 검사**가
    // 대신 막아 준다. 정리를 겨누는 것은 이쪽이다 — ref 가 살아 있는 채로 청취자만 쌓인다.
    stubRegister()
    const { view, frame, onOpen: stale } = await mount()
    const fresh = vi.fn()

    view.rerender(<ExtensionHtmlView html="<p>hi</p>" onOpen={fresh} />)
    post(frame!.contentWindow, OPEN)

    expect(fresh).toHaveBeenCalledTimes(1)
    expect(stale).not.toHaveBeenCalled()
  })
})

describe('테마 주입', () => {
  afterEach(() => document.documentElement.removeAttribute('data-theme'))

  it('지금 테마의 색을 읽어 문서에 심는다 — iframe 은 별개 문서라 변수를 물려받지 못한다', async () => {
    document.documentElement.style.setProperty('--dc-bg', 'rgb(1, 2, 3)')
    const { docs } = stubRegister()

    await mount()

    expect(docs[0]).toContain('rgb(1, 2, 3)')
  })

  it('테마를 바꾸면 문서를 다시 만든다 — 안 하면 확장 화면만 옛 색으로 남는다', async () => {
    document.documentElement.style.setProperty('--dc-bg', 'rgb(1, 2, 3)')
    const { docs } = stubRegister()
    await mount()

    document.documentElement.style.setProperty('--dc-bg', 'rgb(9, 9, 9)')
    document.documentElement.setAttribute('data-theme', 'light')
    // MutationObserver 는 마이크로태스크로 온다 — 다시 등록되기까지 두 번 비운다
    await act(async () => {})
    await act(async () => {})

    expect(docs).toHaveLength(2)
    expect(docs[1]).toContain('rgb(9, 9, 9)')
  })
})
