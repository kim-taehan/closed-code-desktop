import { describe, expect, it } from 'vitest'
import { createDavisApi, METHOD_AGENT_ASK } from './davisApi'
import { deliverAgentActivity, type AgentActivity } from './agentActivityBus'
import { dispatchDavisApi, REFUSE_STORAGE, refuseAskText, refuseExport } from './serviceDispatch'
import { NOTICE_AGENT_ACTIVITY } from './rpc'
import { ExtensionWorkspace } from './workspaceApi'

// **어시스턴트가 답하는 도중의 활동**이 확장까지 오는 길.
//
// 잡는 회귀: `davis.agent.ask` 는 최종 답만 준다. 질의 하나가 수십 초~수 분이라 그동안
// 확장이 화면에 말할 것이 없어 **멈춘 것처럼 보였다** (실측 불만: *"채팅 진행중인 내용도
// 보여주면 안될까 멈춘것 같아"*). 레인에는 `thinking`·`tool_call` 청크가 이미 들어오는데
// 텍스트만 남기고 버리고 있었다.
//
// 배달은 **응답이 아니라 통지**다 — 왕복 하나에 응답이 여럿이면 `PendingRequests` 가 깨진다.
// 그래서 열쇠가 확장 이름이고, 그 이름은 **API 층이 도장 찍는다** (`storage` 와 같은 규칙).

describe('davis.agent.ask 의 활동 통로', () => {
  it('확장 이름을 API 층이 채운다 — 남의 화면에 자기 활동을 못 찍는다', async () => {
    const sent: { method: string; params?: unknown }[] = []
    const api = createDavisApi((method, params) => {
      sent.push({ method, params })
      return Promise.resolve('답')
    }, 'test-scenario')

    await api.agent.ask('무엇이 있나')

    expect(sent).toEqual([
      { method: METHOD_AGENT_ASK, params: { extension: 'test-scenario', prompt: '무엇이 있나' } },
    ])
  })

  it('묻는 동안 온 활동이 그 확장에 배달된다', async () => {
    const got: AgentActivity[] = []
    let release = (_: unknown) => {}
    const api = createDavisApi(() => new Promise((resolve) => (release = resolve)), 'test-scenario')

    const answer = api.agent.ask('무엇이 있나', (activity) => got.push(activity))
    deliverAgentActivity('test-scenario', { kind: 'tool', text: 'grep_search {"q":"router"}' })
    deliverAgentActivity('test-scenario', { kind: 'thinking', text: '컨트롤러를 먼저 본다' })
    release('답')
    await answer

    expect(got).toEqual([
      { kind: 'tool', text: 'grep_search {"q":"router"}' },
      { kind: 'thinking', text: '컨트롤러를 먼저 본다' },
    ])
  })

  // 안 거두면 다음 질의의 활동이 앞 질의 화면으로 흘러간다
  it('질의가 끝나면 더 이상 받지 않는다', async () => {
    const got: AgentActivity[] = []
    const api = createDavisApi(() => Promise.resolve('답'), 'test-scenario')

    await api.agent.ask('무엇이 있나', (activity) => got.push(activity))
    deliverAgentActivity('test-scenario', { kind: 'text', text: '늦게 온 것' })

    expect(got).toEqual([])
  })

  it('남의 확장 이름으로 온 것은 배달되지 않는다', async () => {
    const got: AgentActivity[] = []
    let release = (_: unknown) => {}
    const api = createDavisApi(() => new Promise((resolve) => (release = resolve)), 'test-scenario')

    const answer = api.agent.ask('무엇이 있나', (activity) => got.push(activity))
    deliverAgentActivity('current-analysis', { kind: 'tool', text: '남의 것' })
    release('답')
    await answer

    expect(got).toEqual([])
  })

  it('기다리는 사람이 없어도 터지지 않는다', () => {
    expect(() => deliverAgentActivity('아무도-안-씀', { kind: 'text', text: '허공' })).not.toThrow()
  })

  it('부모는 활동을 통지로 내보낸다 — 응답 자리를 쓰지 않는다', async () => {
    const notices: { method: string; params: unknown }[] = []
    const deps = {
      workspace: new ExtensionWorkspace(() => null),
      exportFile: refuseExport,
      askText: refuseAskText,
      storage: REFUSE_STORAGE,
      activeFile: () => null,
      projectId: () => 'p1',
      emitRows: () => {},
      emitHtml: () => {},
      emitTree: () => {},
      emitProgress: () => {},
      notifyChild: (method: string, params: unknown) => notices.push({ method, params }),
      // 레인 대신 선다 — 묻는 동안 활동을 둘 흘리고 답을 준다
      ask: async (_prompt: string, _projectId: string | null, onActivity?: (a: AgentActivity) => void) => {
        onActivity?.({ kind: 'tool', text: 'read_file src/A.tsx' })
        onActivity?.({ kind: 'text', text: '정리하면' })
        return '최종 답'
      },
    }

    const answer = await dispatchDavisApi(deps, {
      kind: 'request',
      id: '1',
      method: METHOD_AGENT_ASK,
      params: { extension: 'test-scenario', prompt: '무엇이 있나' },
    })

    expect(answer).toBe('최종 답')
    expect(notices).toEqual([
      {
        method: NOTICE_AGENT_ACTIVITY,
        params: { extension: 'test-scenario', kind: 'tool', text: 'read_file src/A.tsx' },
      },
      { method: NOTICE_AGENT_ACTIVITY, params: { extension: 'test-scenario', kind: 'text', text: '정리하면' } },
    ])
  })
})
