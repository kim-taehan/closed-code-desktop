// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { App } from './App'
import { emit, installDavisMock, type DavisMock } from './appWiringHarness'

// 확장의 `code.workspace.openFile` 이 **본문 탭까지 이어져 있는가** (재설계 §2-4).
//
// 훅 혼자(`state/useExtensionOpenFile.test.tsx`)와 창 배선 혼자(`electron/ipc/extensionUiBridge.test.ts`)는
// 각자 잠겨 있어도 **App 이 그 훅을 안 부르면** 아무 일도 안 일어난다 — 층이 잠긴 것과 층 사이가
// 이어진 것은 다른 물음이다 (`App.chatPost.test.tsx` 가 같은 이유로 있다).

let davis: DavisMock

const tabs = () => [...document.querySelectorAll('.main-tab__label')].map((tab) => tab.textContent)
const open = (payload: { path: string; line?: number }, projectId = 'p1') =>
  act(() => emit(davis, 'onExtensionOpenFile', payload, projectId))

async function mountApp(): Promise<void> {
  render(<App />)
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  davis = installDavisMock()
})

afterEach(cleanup)

describe('code.workspace.openFile — 편집기 탭으로 연다', () => {
  it('확장이 민 파일이 본문 탭으로 열리고 그 탭이 앞에 선다', async () => {
    await mountApp()

    open({ path: 'src/app.ts', line: 12 })

    expect(tabs()).toContain('app.ts')
    await waitFor(() => expect(davis.readFile).toHaveBeenCalledWith({ projectId: 'p1', path: 'src/app.ts' }))
    expect(document.querySelector('.main-tab--active')?.textContent).toContain('app.ts')
  })

  it('다른 프로젝트로 온 것은 이 화면에 탭을 만들지 않는다', async () => {
    await mountApp()

    open({ path: 'src/app.ts' }, 'p2')

    expect(tabs()).not.toContain('app.ts')
    expect(davis.readFile).not.toHaveBeenCalled()
  })
})
