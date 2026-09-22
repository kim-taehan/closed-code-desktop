import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import { UI_MESSAGE_MAX_BYTES } from '../../shared/extensions/uiMessage'

// 웹뷰 탭 채널 배선 (창 수명). **앞단 메시지의 행선지는 토큰이 정한다** — 화면이 실어 보낸
// 확장·뷰·프로젝트를 믿지 않는다. 그리고 창이 떨어지면 토큰도 전부 놓는다.

const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}))

const FIXTURE = join(__dirname, '../../tests/extensions/webview-v3')
let dir = ''

beforeEach(async () => {
  handlers.clear()
  dir = await mkdtemp(join(tmpdir(), 'ui-bridge-'))
  await cp(FIXTURE, join(dir, 'webview-v3'), { recursive: true })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function bed() {
  const { ExtensionUiBridge } = await import('./extensionUiBridge')
  const { ExtensionUiRouter } = await import('../extensions/uiRouter')
  const { ExtensionUiServer } = await import('../extensions/uiServer')
  const sent: { channel: string; payload: unknown }[] = []
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
  const service = {
    webview: vi.fn(async () => ({ ok: true as const, dir: join(dir, 'webview-v3'), entry: 'ui/index.html', title: '보드' })),
    uiMessage: vi.fn(async () => {}),
  }
  const router = new ExtensionUiRouter(new ExtensionUiServer(() => 'tok'))
  const bridge = new ExtensionUiBridge({ window: window as never, service, router, activeProjectId: () => 'P' })
  bridge.register()
  const invoke = (channel: string, payload: unknown) => Promise.resolve(handlers.get(channel)!({}, payload))
  return { bridge, router, service, sent, invoke }
}

describe('웹뷰 탭 채널', () => {
  it('탭을 띄우면 토큰·URL·제목을 준다', async () => {
    const { invoke } = await bed()
    const opened = await invoke(Channel.EXTENSION_UI_OPEN_VIEW, { extension: 'webview-fixture', viewId: 'board', projectId: 'P' })
    expect(opened).toEqual({ ok: true, token: 'tok', url: 'code-ext://ui/tok/index.html', title: '보드' })
  })

  it('앞단 메시지는 **토큰이 묶은** 확장·뷰·프로젝트로 간다', async () => {
    const { invoke, service } = await bed()
    await invoke(Channel.EXTENSION_UI_OPEN_VIEW, { extension: 'webview-fixture', viewId: 'board', projectId: 'P' })

    await invoke(Channel.EXTENSION_UI_SEND, { token: 'tok', message: { n: 1 } })

    expect(service.uiMessage).toHaveBeenCalledWith('webview-fixture', 'board', 'P', { n: 1 })
  })

  it('모르는 토큰·1MB 초과는 사유와 함께 거부하고 뒷단에 안 간다', async () => {
    const { invoke, service } = await bed()
    await expect(invoke(Channel.EXTENSION_UI_SEND, { token: 'nope', message: 1 })).rejects.toThrow('닫힌')
    await invoke(Channel.EXTENSION_UI_OPEN_VIEW, { extension: 'webview-fixture', viewId: 'board', projectId: 'P' })
    await expect(
      invoke(Channel.EXTENSION_UI_SEND, { token: 'tok', message: 'a'.repeat(UI_MESSAGE_MAX_BYTES) }),
    ).rejects.toThrow('너무 큽니다')
    expect(service.uiMessage).not.toHaveBeenCalled()
  })

  it('뒷단이 민 것은 그 토큰을 달고 창으로 간다. 탭을 닫으면 더 안 간다', async () => {
    const { invoke, router, sent } = await bed()
    await invoke(Channel.EXTENSION_UI_OPEN_VIEW, { extension: 'webview-fixture', viewId: 'board', projectId: 'P' })

    expect(router.post('webview-fixture', 'board', { a: 1 }, 'P')).toBe(true)
    expect(router.post('webview-fixture', 'board', { a: 2 }, 'Q')).toBe(false)
    await invoke(Channel.EXTENSION_UI_CLOSE_VIEW, { token: 'tok' })
    expect(router.post('webview-fixture', 'board', { a: 3 }, 'P')).toBe(false)

    expect(sent).toEqual([{ channel: Channel.EXTENSION_UI_MESSAGE, payload: { token: 'tok', message: { a: 1 } } }])
  })

  it('창이 떨어지면 핸들러를 풀고 토큰도 놓는다', async () => {
    const { bridge, invoke, router } = await bed()
    await invoke(Channel.EXTENSION_UI_OPEN_VIEW, { extension: 'webview-fixture', viewId: 'board', projectId: 'P' })

    bridge.dispose()

    expect(handlers.size).toBe(0)
    expect(router.server.binding('tok')).toBeNull()
    expect(router.post('webview-fixture', 'board', 1, 'P')).toBe(false)
  })

  // 하이닉스 H2 K-3 — 입력칸은 화면의 프로젝트 하나에만 있다 (`bed` 의 화면 프로젝트는 P)
  it('chat.post 는 화면에 떠 있는 프로젝트에만 겉봉을 달아 보내고, 아니면 「먼저 여세요」로 거부한다', async () => {
    const { router, sent } = await bed()

    router.chatPost('P', '설계서')
    expect(() => router.chatPost('Q', '남의 것')).toThrow('먼저 여세요')

    expect(sent).toEqual([{ channel: Channel.EXTENSION_CHAT_POST, payload: { projectId: 'P', payload: { text: '설계서' } } }])
  })
})
