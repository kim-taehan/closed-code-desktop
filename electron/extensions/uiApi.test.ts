import { describe, expect, it } from 'vitest'
import { createExtensionApi, METHOD_UI_OPEN, METHOD_UI_POST } from './extensionApi'
import { dispatchUi } from './uiDispatch'
import { UiHandlers } from './uiHandlers'
import type { UiPorts } from './uiRouter'
import { UI_MESSAGE_MAX_BYTES } from '../../shared/extensions/uiMessage'

// `code.ui.*` 의 자식 쪽 대리자와 main 쪽 받는 자리 (E3).
// 왕복 전체는 `webviewRuntime.test.ts` 가 진짜 자식으로 본다. 여기는 **경계마다 거르는가**다.

const HUGE = 'a'.repeat(UI_MESSAGE_MAX_BYTES)

function recording() {
  const calls: { method: string; params: unknown }[] = []
  const call = async (method: string, params?: unknown) => {
    calls.push({ method, params })
    return true
  }
  return { calls, call }
}

describe('자식 — code.ui.post', () => {
  it('확장 이름은 호스트가 채운다 — 확장이 남의 탭에 밀 자리가 없다', async () => {
    const { calls, call } = recording()
    const api = createExtensionApi(call, 'mine')

    expect(await api.ui.post('board', { a: 1 })).toBe(true)

    expect(calls).toEqual([{ method: METHOD_UI_POST, params: { extension: 'mine', viewId: 'board', message: { a: 1 } } }])
  })

  // 계약 대조 2026-09-22 실측: `target` 을 펼치던 시절 이 호출이 extB 의 탭까지 갔다
  it('target 에 실은 extension·message 는 버린다 — projectId 만 쓴다', async () => {
    const { calls, call } = recording()
    const api = createExtensionApi(call, 'mine')
    const forged = { projectId: 'P', extension: 'extB', message: { swapped: true } } as { projectId: string }

    await api.ui.post('board', { hi: 1 }, forged)
    await api.ui.open('board', forged)

    expect(calls).toEqual([
      { method: METHOD_UI_POST, params: { projectId: 'P', extension: 'mine', viewId: 'board', message: { hi: 1 } } },
      { method: METHOD_UI_OPEN, params: { projectId: 'P', extension: 'mine', viewId: 'board' } },
    ])
  })

  it('앱 예약 type(__app:) 은 뒷단이 못 보낸다 — 화면이 「앱이 보냈다」로 읽는다', async () => {
    const { calls, call } = recording()
    await expect(createExtensionApi(call, 'mine').ui.post('board', { type: '__app:theme', vars: {} })).rejects.toThrow('앱만 보냅니다')
    expect(calls).toEqual([])
  })

  it('1MB 를 넘으면 **보내기 전에** 사유와 함께 거부한다', async () => {
    const { calls, call } = recording()
    const api = createExtensionApi(call, 'mine')

    await expect(api.ui.post('board', HUGE)).rejects.toThrow('너무 큽니다')
    await expect(api.ui.post('board', { at: new Date() })).rejects.toThrow('평범한 객체가 아닙니다')
    expect(calls).toEqual([])
  })

  it('open 도 이름을 호스트가 채우고, 적은 프로젝트를 싣는다', async () => {
    const { calls, call } = recording()
    await createExtensionApi(call, 'mine').ui.open('board', { projectId: 'P' })
    expect(calls).toEqual([{ method: METHOD_UI_OPEN, params: { extension: 'mine', viewId: 'board', projectId: 'P' } }])
  })

  it('처리기 표 없이 onMessage 를 걸면 던진다 — 조용히 안 받는 확장을 만들지 않는다', () => {
    const { call } = recording()
    expect(() => createExtensionApi(call, 'mine').ui.onMessage('board', () => {})).toThrow('받을 자리가 없습니다')
  })

  it('onMessage 는 (확장·뷰)로 갈린다 — 남의 확장 화면이 보낸 것을 받지 않는다', async () => {
    const { call } = recording()
    const ui = new UiHandlers()
    const got: unknown[] = []
    createExtensionApi(call, 'mine', undefined, ui).ui.onMessage('board', (message, context) => {
      got.push([message, context])
    })

    await ui.deliver('mine', 'board', { a: 1 }, 'P')
    await expect(ui.deliver('theirs', 'board', { a: 2 }, 'P')).rejects.toThrow('받지 않습니다')

    expect(got).toEqual([[{ a: 1 }, { projectId: 'P' }]])
  })
})

describe('main — 받는 자리 (dispatchUi)', () => {
  function ports() {
    const posted: unknown[] = []
    const opened: unknown[] = []
    const value: UiPorts = {
      post: (...args) => {
        posted.push(args)
        return true
      },
      open: async (...args) => {
        opened.push(args)
      },
    }
    return { posted, opened, value }
  }

  it('겉봉이 없고 프로젝트도 안 적었으면 던진다 — **활성 프로젝트로 되돌아가지 않는다**', () => {
    const { posted, value } = ports()
    expect(() => dispatchUi(value, METHOD_UI_POST, { extension: 'e', viewId: 'v', message: 1 }, null)).toThrow(
      '어느 프로젝트의 탭인지 모릅니다',
    )
    expect(posted).toEqual([])
  })

  it('겉봉 프로젝트로 보낸다. 확장이 적은 프로젝트가 있으면 그것이 이긴다', () => {
    const { posted, value } = ports()
    dispatchUi(value, METHOD_UI_POST, { extension: 'e', viewId: 'v', message: 1 }, 'P')
    dispatchUi(value, METHOD_UI_POST, { extension: 'e', viewId: 'v', message: 2, projectId: 'Q' }, 'P')
    expect(posted).toEqual([
      ['e', 'v', 1, 'P'],
      ['e', 'v', 2, 'Q'],
    ])
  })

  // 계약 대조 2026-09-22 실측: 빈 칸 projectId 가 사유 없이 겉봉 프로젝트로 떨어졌다
  it('적었는데 쓸 수 없는 projectId 는 겉봉으로 떨어지지 않고 던진다', () => {
    const { posted, value } = ports()
    for (const bad of ['', 42, null]) {
      expect(() => dispatchUi(value, METHOD_UI_POST, { extension: 'e', viewId: 'v', message: 1, projectId: bad }, 'ENV')).toThrow(
        'projectId 는',
      )
    }
    expect(posted).toEqual([])
  })

  it('프로세스 경계라 앱 예약 type 도 다시 본다', () => {
    const { posted, value } = ports()
    expect(() =>
      dispatchUi(value, METHOD_UI_POST, { extension: 'e', viewId: 'v', message: { type: '__app:rejected' } }, 'P'),
    ).toThrow('앱만 보냅니다')
    expect(posted).toEqual([])
  })

  it('프로세스 경계라 크기를 다시 본다 — 자식이 거르지 않았어도 여기서 막힌다', () => {
    const { posted, value } = ports()
    expect(() => dispatchUi(value, METHOD_UI_POST, { extension: 'e', viewId: 'v', message: HUGE }, 'P')).toThrow(
      '너무 큽니다',
    )
    expect(posted).toEqual([])
  })
})
