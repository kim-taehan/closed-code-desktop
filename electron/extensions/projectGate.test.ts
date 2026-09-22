import { describe, expect, it } from 'vitest'
import { METHOD_AI_CANCEL, METHOD_AI_RUN, METHOD_UI_OPEN, METHOD_UI_POST } from './extensionApi'
import { dispatchExtensionApi, portsOf } from './serviceDispatch'
import { createRequest } from './rpc'
import { ExtensionWorkspace } from './workspaceApi'
import type { ExtensionAiPort } from './aiDispatch'
import type { UiPorts } from './uiRouter'

// 웹뷰·AI 도 **그 프로젝트에서 켜진 확장만** 쓴다 (`uiDispatch.ts` 의 `requireEnabled`).
// 명시 projectId 로 명령 밖에서 부르면 꺼진 프로젝트의 탭에 밀거나 서버를 띄울 수 있었다 (4단계 보고).

function dispatcher(allowed: readonly string[] | undefined) {
  const reached: string[] = []
  const ui: UiPorts = {
    post: () => (reached.push('post'), true),
    open: async () => void reached.push('open'),
  } as unknown as UiPorts
  const ai: ExtensionAiPort = {
    run: async () => (reached.push('run'), { text: '' }),
    cancel: () => void reached.push('cancel'),
  }
  const deps = portsOf(
    { workspace: new ExtensionWorkspace(() => null), ui, ai },
    {
      projectId: () => 'P',
      allowedIn: async () => allowed,
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

const base = { extension: 'mine', viewId: 'board', runId: 'r1', prompt: '물음', message: { a: 1 } }

describe('프로젝트에서 켜졌는가', () => {
  it('꺼진 프로젝트로는 ui.post · ui.open · ai.run 이 닿지 않는다', async () => {
    const { call, reached } = dispatcher(['other'])
    for (const method of [METHOD_UI_POST, METHOD_UI_OPEN, METHOD_AI_RUN]) {
      await expect(call(method, base)).rejects.toThrow('켜지 않은 확장')
    }
    expect(reached).toEqual([])
  })

  it('명시 projectId 로 돌아가도 그 프로젝트의 켜짐을 본다', async () => {
    const seen: string[] = []
    // 겉봉(P)에는 켜져 있어도, 적은 프로젝트(Q)에 꺼져 있으면 막힌다
    const perProject = portsOf(
      { workspace: new ExtensionWorkspace(() => null), ai: { run: async () => ({ text: '' }), cancel: () => {} } },
      {
        projectId: () => 'P',
        allowedIn: async (projectId) => (seen.push(projectId), projectId === 'P' ? ['mine'] : []),
        emitRows: () => {},
        emitHtml: () => {},
        emitTree: () => {},
        emitProgress: () => {},
        notifyChild: () => {},
      },
    )
    await expect(dispatchExtensionApi(perProject, createRequest(METHOD_AI_RUN, { ...base, projectId: 'Q' }))).rejects.toThrow(
      '켜지 않은 확장',
    )
    expect(seen).toEqual(['Q'])
    await expect(dispatchExtensionApi(perProject, createRequest(METHOD_AI_RUN, base))).resolves.toEqual({ text: '' })
  })

  it('켜져 있으면 그대로 간다', async () => {
    const { call, reached } = dispatcher(['mine'])
    await call(METHOD_UI_POST, base)
    await call(METHOD_UI_OPEN, base)
    await call(METHOD_AI_RUN, base)
    expect(reached).toEqual(['post', 'open', 'run'])
  })

  // 켜짐이 바뀐 뒤에도 이미 도는 것은 끊을 수 있어야 한다
  it('ai.cancel 은 막지 않는다', async () => {
    const { call, reached } = dispatcher([])
    await call(METHOD_AI_CANCEL, base)
    expect(reached).toEqual(['cancel'])
  })

  it('정책이 배선되지 않았으면(undefined) 보지 않는다', async () => {
    const { call, reached } = dispatcher(undefined)
    await call(METHOD_AI_RUN, base)
    expect(reached).toEqual(['run'])
  })
})
