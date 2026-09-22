import { describe, expect, it } from 'vitest'
import { createExtensionApi, METHOD_AI_CANCEL, METHOD_AI_RUN } from './extensionApi'
import { dispatchExtensionApi, portsOf, type DispatchPorts } from './serviceDispatch'
import { AiStreams } from './aiRunClient'
import { NOTICE_AI_TEXT, createRequest } from './rpc'
import { ExtensionWorkspace } from './workspaceApi'
import type { AiRunRequest, ExtensionAiPort } from './aiDispatch'
import { fakeOpencode, makeRuns, settle } from '../opencode/extensionRunTestKit'

// `code.ai.run` 의 확장 호스트 쪽 — 행선지 규칙(겉봉·projectId)·글 조각 통지·끊기, 그리고 자식 대리자부터
// opencode 세션까지 **층 사이가 이어졌나** (각 층의 시험은 `extensionRun.test.ts`).

/** 부른 것만 적는 AI 포트 */
function spyPort(answer = { text: '답' }) {
  const runs: AiRunRequest[] = []
  const cancels: [string, string][] = []
  let emit: (text: string) => void = () => {}
  const port: ExtensionAiPort = {
    run: async (request, onText) => {
      runs.push(request)
      emit = onText
      return answer
    },
    cancel: (extension, runId) => void cancels.push([extension, runId]),
  }
  return { port, runs, cancels, text: (piece: string) => emit(piece) }
}

/** 서비스가 하는 그대로 — `portsOf` 로 채우고 `dispatchExtensionApi` 로 부른다 */
function dispatcher(ai: ExtensionAiPort | undefined, envelope: string | null) {
  const notices: [string, unknown][] = []
  const ports: DispatchPorts = { workspace: new ExtensionWorkspace(() => null), ...(ai ? { ai } : {}) }
  const deps = portsOf(ports, {
    projectId: () => envelope,
    allowedIn: async () => undefined,
    emitRows: () => {},
    emitHtml: () => {},
    emitTree: () => {},
    emitProgress: () => {},
    notifyChild: (method, params) => void notices.push([method, params]),
  })
  const call = (method: string, params: unknown) => dispatchExtensionApi(deps, createRequest(method, params))
  return { call, notices }
}

const run = (extra: Record<string, unknown> = {}) => ({ extension: 'ext-a', runId: 'r1', prompt: '물음', ...extra })

describe('어느 프로젝트에 묻나 — ui.post 와 같은 규칙', () => {
  it('겉봉이 있으면 그 프로젝트', async () => {
    const spy = spyPort()
    await dispatcher(spy.port, 'p1').call(METHOD_AI_RUN, run())
    expect(spy.runs.map((request) => request.projectId)).toEqual(['p1'])
  })

  it('적은 projectId 가 겉봉보다 먼저다', async () => {
    const spy = spyPort()
    await dispatcher(spy.port, 'p1').call(METHOD_AI_RUN, run({ projectId: 'p2' }))
    expect(spy.runs.map((request) => request.projectId)).toEqual(['p2'])
  })

  it('둘 다 없으면 거부한다 — 활성 프로젝트로 보내지 않는다', async () => {
    const spy = spyPort()
    await expect(dispatcher(spy.port, null).call(METHOD_AI_RUN, run())).rejects.toThrow('어느 프로젝트')
    expect(spy.runs).toEqual([])
  })

  it('적었는데 쓸 수 없는 값이면 겉봉으로 떨어지지 않고 거부한다', async () => {
    const spy = spyPort()
    for (const projectId of ['', 7, null]) {
      await expect(dispatcher(spy.port, 'p1').call(METHOD_AI_RUN, run({ projectId }))).rejects.toThrow('projectId')
    }
    expect(spy.runs).toEqual([])
  })

  it('배선이 없으면 사유와 함께 거부한다', async () => {
    await expect(dispatcher(undefined, 'p1').call(METHOD_AI_RUN, run())).rejects.toThrow('배선 없음')
  })
})

describe('글 조각과 끊기', () => {
  it('stream 을 청한 실행만 조각을 통지로 내린다', async () => {
    const spy = spyPort()
    const bed = dispatcher(spy.port, 'p1')
    await bed.call(METHOD_AI_RUN, run({ stream: true }))
    spy.text('가')
    await bed.call(METHOD_AI_RUN, run({ runId: 'r2' }))
    spy.text('나')

    expect(bed.notices).toEqual([[NOTICE_AI_TEXT, { runId: 'r1', text: '가' }]])
  })

  it('ai.cancel 은 그 확장·실행으로 포트를 부른다', async () => {
    const spy = spyPort()
    await dispatcher(spy.port, null).call(METHOD_AI_CANCEL, { extension: 'ext-a', runId: 'r1' })
    expect(spy.cancels).toEqual([['ext-a', 'r1']])
  })
})

describe('자식 대리자 (code.ai.run)', () => {
  it('확장 이름은 대리자가 채우고, 조각은 그 실행의 onText 로만 간다', async () => {
    const streams = new AiStreams()
    const sent: { method: string; params: Record<string, unknown> }[] = []
    const api = createExtensionApi(
      (method, params) => {
        sent.push({ method, params: params as Record<string, unknown> })
        const runId = (params as { runId: string }).runId
        streams.deliver({ runId: 'someone-else', text: '남의 것' })
        streams.deliver({ runId, text: '조각' })
        return Promise.resolve({ text: '조각' })
      },
      'ext-a',
      undefined,
      undefined,
      streams,
    )
    const pieces: string[] = []

    await expect(api.ai.run('물음', { onText: (text) => pieces.push(text), projectId: 'p9' })).resolves.toEqual({
      text: '조각',
    })
    expect(pieces).toEqual(['조각'])
    expect(sent[0]).toMatchObject({
      method: METHOD_AI_RUN,
      params: { extension: 'ext-a', prompt: '물음', stream: true, projectId: 'p9' },
    })
  })

  it('signal 을 abort 하면 부모에게 ai.cancel 을 올리고, 이미 abort 된 것은 부르지도 않는다', async () => {
    const sent: { method: string; params: unknown }[] = []
    let finish: (value: unknown) => void = () => {}
    const api = createExtensionApi((method, params) => {
      sent.push({ method, params })
      return method === METHOD_AI_RUN ? new Promise((resolve) => (finish = resolve)) : Promise.resolve(undefined)
    }, 'ext-a')
    const controller = new AbortController()
    const pending = api.ai.run('물음', { signal: controller.signal })
    controller.abort()
    finish({ text: '' })
    await pending
    const runId = (sent[0]?.params as { runId: string }).runId
    expect(sent[1]).toEqual({ method: METHOD_AI_CANCEL, params: { extension: 'ext-a', runId } })

    sent.length = 0
    await expect(api.ai.run('물음', { signal: AbortSignal.abort() })).rejects.toThrow('취소')
    expect(sent).toEqual([])
  })
})

describe('층 사이 — 자식 대리자 → 디스패치 → 확장 세션 → 가짜 opencode', () => {
  function wired() {
    const server = fakeOpencode()
    const streams = new AiStreams()
    const bed = dispatcher(makeRuns(server), 'p1')
    // 부모의 통지를 자식의 조각 표로 — `hostEntry.ts` 가 하는 일
    const deliver = () => {
      for (const [method, params] of bed.notices.splice(0)) if (method === NOTICE_AI_TEXT) streams.deliver(params)
    }
    return { server, api: createExtensionApi(bed.call, 'ext-a', undefined, undefined, streams), deliver }
  }

  it('사용자 세션 글은 섞이지 않고 제 세션 글만 onText 와 답으로 온다', async () => {
    const { server, api, deliver } = wired()
    const pieces: string[] = []
    const answer = api.ai.run('물음', { onText: (text) => pieces.push(text) })
    await settle()
    const sessionId = server.lastCreated
    server.emit('message.part.delta', { sessionID: 'ses_user', partID: 'u', field: 'text', delta: '사용자' })
    server.emit('message.part.delta', { sessionID: sessionId, partID: 'e', field: 'text', delta: '확장' })
    await settle()
    deliver()
    server.emit('session.idle', { sessionID: sessionId })

    await expect(answer).resolves.toEqual({ text: '확장' })
    expect(pieces).toEqual(['확장'])
  })

  it('signal 로 끊으면 그 세션을 abort 하고 취소 사유로 거부된다', async () => {
    const { server, api } = wired()
    const controller = new AbortController()
    const answer = api.ai.run('물음', { signal: controller.signal })
    await settle()
    controller.abort()

    await expect(answer).rejects.toThrow('취소')
    expect(server.paths('POST')).toContain(`/session/${server.lastCreated}/abort`)
  })
})
