import { describe, expect, it } from 'vitest'
import {
  CHAT_POST_MAX_BYTES,
  createExtensionApi,
  METHOD_AI_RUN,
  METHOD_CHAT_POST,
  METHOD_UI_OPEN,
  METHOD_UI_POST,
} from './extensionApi'
import { dispatchExtensionApi, portsOf } from './serviceDispatch'
import { createRequest } from './rpc'
import { ExtensionWorkspace } from './workspaceApi'
import type { ExtensionAiPort } from './aiDispatch'
import type { UiPorts } from './uiRouter'

// 하이닉스 H2 — `code.chat.post`(K-3)와 겉봉 두 번 읽기(K-4).
//
// chat.post 가 **입력칸에 넣기만 하고 보내지 않는다**·쓰던 글 뒤에 붙는다는 것은 화면 쪽
// (`src/components/ChatComposer.chatPost.test.tsx`)이 보고, 「화면에 없는 프로젝트면 거부」는 창 배선
// (`electron/ipc/extensionUiBridge.test.ts`)이 본다. 여기는 **어느 프로젝트로 가나**와 글의 규칙이다.

/**
 * @param envelope 부를 때마다 읽히는 겉봉. 함수라서 await 사이에 바뀌는 것을 흉내낼 수 있다
 * @param allowedIn 켜짐 판정 — 판정 도중 겉봉을 바꾸는 시험이 여기에 끼어든다
 */
function dispatcher(
  envelope: () => string | null,
  allowedIn: (projectId: string) => Promise<readonly string[] | undefined> = async () => ['mine'],
) {
  const reached: unknown[][] = []
  const ui: UiPorts = {
    post: (...args) => (reached.push(['post', ...args]), true),
    open: async (...args) => void reached.push(['open', ...args]),
    chatPost: (...args) => void reached.push(['chatPost', ...args]),
  }
  const ai: ExtensionAiPort = {
    run: async (request) => (reached.push(['run', request.projectId]), { text: '' }),
    cancel: () => {},
  }
  const deps = portsOf(
    { workspace: new ExtensionWorkspace(() => null), ui, ai },
    {
      projectId: envelope,
      allowedIn,
      emitRows: () => {},
      emitHtml: () => {},
      emitTree: () => {},
      emitProgress: () => {},
      notifyChild: () => {},
    },
  )
  const call = (method: string, params: unknown) => dispatchExtensionApi(deps, createRequest(method, params))
  return { call, reached }
}

describe('자식 — code.chat.post', () => {
  it('확장 이름은 호스트가 채우고, target 에서는 projectId 만 꺼낸다', async () => {
    const calls: unknown[] = []
    const api = createExtensionApi(async (method, params) => void calls.push({ method, params }), 'mine')
    const forged = { projectId: 'P', extension: 'extB', text: '바꿔치기' } as { projectId: string }

    await api.chat.post('설계서')
    await api.chat.post('다음', forged)

    expect(calls).toEqual([
      { method: METHOD_CHAT_POST, params: { extension: 'mine', text: '설계서' } },
      { method: METHOD_CHAT_POST, params: { projectId: 'P', extension: 'mine', text: '다음' } },
    ])
  })
})

describe('main — chat.post 의 프로젝트 (ui.post 와 같은 규칙)', () => {
  it('겉봉의 프로젝트 입력칸으로 간다. 적은 projectId 가 있으면 그것이 이긴다', async () => {
    const { call, reached } = dispatcher(() => 'P')
    await call(METHOD_CHAT_POST, { extension: 'mine', text: '하나' })
    await call(METHOD_CHAT_POST, { extension: 'mine', text: '둘', projectId: 'Q' })
    expect(reached).toEqual([
      ['chatPost', 'P', '하나'],
      ['chatPost', 'Q', '둘'],
    ])
  })

  it('겉봉도 projectId 도 없으면 거부한다 — 화면의 프로젝트로 되돌아가지 않는다', async () => {
    const { call, reached } = dispatcher(() => null)
    await expect(call(METHOD_CHAT_POST, { extension: 'mine', text: '글' })).rejects.toThrow('어느 프로젝트')
    expect(reached).toEqual([])
  })

  it('그 프로젝트에서 꺼진 확장은 넣지 못한다', async () => {
    const { call, reached } = dispatcher(() => 'P', async () => ['other'])
    await expect(call(METHOD_CHAT_POST, { extension: 'mine', text: '글' })).rejects.toThrow('켜지 않은 확장')
    expect(reached).toEqual([])
  })
})

describe('main — chat.post 의 글', () => {
  it(`상한은 UTF-8 ${CHAT_POST_MAX_BYTES}바이트다 — 딱 맞으면 들어가고 한 바이트 넘으면 거부한다`, async () => {
    const { call, reached } = dispatcher(() => 'P')
    await call(METHOD_CHAT_POST, { extension: 'mine', text: 'a'.repeat(CHAT_POST_MAX_BYTES) })
    await expect(call(METHOD_CHAT_POST, { extension: 'mine', text: 'a'.repeat(CHAT_POST_MAX_BYTES + 1) })).rejects.toThrow(
      '너무 깁니다',
    )
    expect(reached).toHaveLength(1)
  })

  it('글자 수가 아니라 바이트로 잰다 — 한글은 3바이트다', async () => {
    const { call, reached } = dispatcher(() => 'P')
    const korean = '가'.repeat(Math.floor(CHAT_POST_MAX_BYTES / 3) + 1)
    await expect(call(METHOD_CHAT_POST, { extension: 'mine', text: korean })).rejects.toThrow('너무 깁니다')
    expect(reached).toEqual([])
  })

  it('빈 글·문자열 아닌 것은 거부한다 — 넣어도 아무 일이 없어 확장이 사유를 못 본다', async () => {
    const { call, reached } = dispatcher(() => 'P')
    for (const text of ['', '  \n', 42, undefined]) {
      await expect(call(METHOD_CHAT_POST, { extension: 'mine', text })).rejects.toThrow()
    }
    expect(reached).toEqual([])
  })
})

// H1 보고 #3 — 켜짐 판정에 한 번, await 뒤 행선지에 또 한 번 겉봉을 읽었다
describe('K-4 — 겉봉은 한 번만 읽는다', () => {
  it('켜짐을 보는 동안 겉봉이 Q 로 바뀌어도 판정한 P 로 간다 (ui.post · ui.open · chat.post · ai.run)', async () => {
    let current: string | null = 'P'
    const judged: string[] = []
    // P 에서만 켜졌다. 판정하는 사이 다른 프로젝트의 일이 겹쳐 겉봉이 Q 가 된다
    const { call, reached } = dispatcher(
      () => current,
      async (projectId) => {
        judged.push(projectId)
        current = 'Q'
        return projectId === 'P' ? ['mine'] : []
      },
    )
    const base = { extension: 'mine', viewId: 'board', message: 1, text: '글', runId: 'r', prompt: '물음' }

    for (const method of [METHOD_UI_POST, METHOD_UI_OPEN, METHOD_CHAT_POST, METHOD_AI_RUN]) {
      current = 'P'
      await call(method, base)
    }

    expect(judged).toEqual(['P', 'P', 'P', 'P'])
    expect(reached).toEqual([
      ['post', 'mine', 'board', 1, 'P'],
      ['open', 'mine', 'board', 'P'],
      ['chatPost', 'P', '글'],
      ['run', 'P'],
    ])
  })
})
