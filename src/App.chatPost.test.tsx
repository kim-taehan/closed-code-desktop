// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { App } from './App'
import { emit, installDavisMock, type DavisMock } from './appWiringHarness'

// 확장의 `code.chat.post` 가 **입력칸에 넣기만 하고 보내지 않는가** (하이닉스 H2 결정 K-3).
//
// 진짜 App 을 띄운다 — 넣는 것(Composer)·거르는 것(useComposerSendBridges)·탭 옮기기(ChatComposer)가
// 세 파일에 흩어져 있어, 한 층씩 재면 「층은 잠겼는데 층 사이가 안 이어진」 초록이 된다 (App.wiring.test.tsx 머리말).
// 「화면에 없는 프로젝트면 거부」는 main 이 한다 (`electron/ipc/extensionUiBridge.test.ts`).

let davis: DavisMock

const composer = () => document.querySelector('.composer-bar textarea') as HTMLTextAreaElement
const post = (text: string, projectId = 'p1') => act(() => emit(davis, 'onExtensionChatPost', { text }, projectId))

async function mountReadyApp(): Promise<void> {
  render(<App />)
  await act(async () => {
    await Promise.resolve()
  })
  act(() => emit(davis, 'onSessionState', { handshake: { stage: 'ready' } }, 'p1'))
}

beforeEach(() => {
  davis = installDavisMock()
})

afterEach(cleanup)

describe('code.chat.post — 입력칸에 넣기만 한다', () => {
  it('글이 입력칸에 들어가고 **나가지 않는다** · 커서가 입력칸에 온다', async () => {
    await mountReadyApp()

    post('설계서를 보고 구현해 주세요')

    expect(composer().value).toBe('설계서를 보고 구현해 주세요')
    expect(davis.sendChat).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(composer())
  })

  it('쓰던 글을 덮지 않고 **빈 줄 하나 띄워** 뒤에 붙인다', async () => {
    await mountReadyApp()
    fireEvent.change(composer(), { target: { value: '쓰던 글' } })

    post('설계서')

    expect(composer().value).toBe('쓰던 글\n\n설계서')
    expect(davis.sendChat).not.toHaveBeenCalled()
  })

  it('다른 프로젝트로 온 글은 이 입력칸에 안 들어간다', async () => {
    await mountReadyApp()
    fireEvent.change(composer(), { target: { value: '쓰던 글' } })

    post('남의 설계서', 'p2')

    expect(composer().value).toBe('쓰던 글')
  })

  it('다른 탭을 보고 있었으면 채팅 탭으로 옮긴다', async () => {
    await mountReadyApp()
    // 본문에 웹뷰 탭을 열어 그 탭을 보게 한다 (`code.ui.open` 과 같은 길)
    act(() => emit(davis, 'onExtensionUiOpen', { extension: 'sidebar-fixture', viewId: 'detail', title: '일감' }, 'p1'))
    await act(async () => {})
    const webview = document.querySelector('.ext-webview') as HTMLElement
    expect(webview.classList.contains('ext-webview--hidden')).toBe(false)

    post('설계서')

    expect(webview.classList.contains('ext-webview--hidden')).toBe(true)
    expect(composer().value).toBe('설계서')
  })
})
