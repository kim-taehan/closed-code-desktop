import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_RUN_CANCELLED, ExtensionAiRuns } from './extensionRun'
import { fakeOpencode, makeRuns, memoryLedger, settle } from './extensionRunTestKit'

// `code.ai.run` 의 opencode 쪽 (`extensionRun.ts`). 가짜 서버는 실물 계약을 흉내낸다 (`extensionRunTestKit.ts`).

const request = (extension = 'ext-a', projectId = 'p1', runId = 'run-1') => ({
  extension,
  projectId,
  runId,
  prompt: '파일을 읽어라',
})

/** 실행을 걸고 세션·스트림·프롬프트까지 가게 둔다. 끝났는지는 `state` 로 본다 */
async function started(server: ReturnType<typeof fakeOpencode>, runs = makeRuns(server), req = request()) {
  const pieces: string[] = []
  const state: { settled: boolean } = { settled: false }
  const result = runs.run(req, (text) => pieces.push(text))
  void result.then(
    () => (state.settled = true),
    () => (state.settled = true),
  )
  await settle()
  return { runs, result, pieces, state, sessionId: server.lastCreated }
}

describe('세션 생성 (F2)', () => {
  it('권한 규칙을 이 순서로 싣는다 — 뒤 규칙이 이긴다. parentID 는 없다', async () => {
    const server = fakeOpencode()
    await started(server)

    const create = server.calls.find((call) => call.method === 'POST' && call.path.startsWith('/session?'))
    expect(create?.path).toBe('/session?directory=%2Ftmp%2Fp1')
    // 스트림도 세션을 세운 디렉토리의 것 — `/event` 는 인스턴스 단위다 (`extensionRun.ts` 실측)
    expect(server.paths('GET')).toContain('/event?directory=%2Ftmp%2Fp1')
    // 상수를 되부르지 않고 글자 그대로 적는다 — 상수의 순서를 뒤집으면 여기가 빨개져야 한다
    expect(create?.body).toEqual({
      title: 'ext:ext-a',
      permission: [
        { permission: '*', pattern: '*', action: 'deny' },
        { permission: 'read', pattern: '*', action: 'allow' },
        { permission: 'glob', pattern: '*', action: 'allow' },
        { permission: 'grep', pattern: '*', action: 'allow' },
        { permission: 'read', pattern: '*.env', action: 'deny' },
      ],
    })
  })

  it('같은 확장·프로젝트는 같은 세션을 다시 쓰고, 다른 확장은 따로 만든다', async () => {
    const server = fakeOpencode()
    const ledger = memoryLedger()
    const runs = makeRuns(server, ledger)
    const first = await started(server, runs)
    server.emit('session.idle', { sessionID: first.sessionId })
    await first.result

    const again = await started(server, runs, request('ext-a', 'p1', 'run-2'))
    expect(server.paths('POST').filter((path) => path.startsWith('/session?'))).toHaveLength(1)
    expect(server.paths('POST')).toContain(`/session/${first.sessionId}/prompt_async`)
    server.emit('session.idle', { sessionID: first.sessionId })
    await again.result

    await started(server, runs, request('ext-b', 'p1', 'run-3'))
    expect(ledger.map.get('ext-b|p1')).toBe('ses_ext2')
  })

  it('장부의 세션을 서버가 모르면(404) 새로 만든다 — 안 그러면 그 프로젝트에서 영영 못 묻는다', async () => {
    const server = fakeOpencode()
    const ledger = memoryLedger({ 'ext-a|p1': 'ses_gone' })
    const { sessionId } = await started(server, makeRuns(server, ledger))

    expect(server.paths('GET')).toContain('/session/ses_gone')
    expect(sessionId).toBe('ses_ext1')
    expect(ledger.map.get('ext-a|p1')).toBe('ses_ext1')
    expect(server.paths('POST')).toContain('/session/ses_ext1/prompt_async')
  })
})

describe('스트림은 제 세션 것만 (F4)', () => {
  it('사용자 세션 이벤트는 ai.run 에 0건, 제 세션 글만 모인다', async () => {
    const server = fakeOpencode()
    const { result, pieces, state, sessionId } = await started(server)

    server.emit('message.part.delta', { sessionID: 'ses_user', partID: 'p0', field: 'text', delta: '사용자 답' })
    server.emit('message.part.delta', { sessionID: sessionId, partID: 'p1', field: 'text', delta: '확장 ' })
    server.emit('message.part.delta', { sessionID: sessionId, partID: 'p1', field: 'reasoning', delta: '생각' })
    server.emit('message.part.delta', { sessionID: sessionId, partID: 'p1', field: 'text', delta: '답' })
    // sessionID 없는 것도 이쪽은 받지 않는다 (fail-closed)
    server.emit('message.part.delta', { partID: 'p9', field: 'text', delta: '주인 없음' })
    server.emit('session.idle', { sessionID: 'ses_user' })
    await settle()
    expect(state.settled, '남의 idle 이 확장 턴을 닫으면 안 된다').toBe(false)

    server.emit('session.idle', { sessionID: sessionId })
    await expect(result).resolves.toEqual({ text: '확장 답' })
    expect(pieces).toEqual(['확장 ', '답'])
    expect(server.openStreams, '끝나면 스트림을 닫는다').toBe(0)
  })

  it('실측 원문 한 턴을 그대로 흘리면 그 답이 나온다 — 도구(glob·read) 단계 포함', async () => {
    const server = fakeOpencode()
    const { result, pieces, sessionId } = await started(server)
    const fixture = JSON.parse(
      readFileSync(join(__dirname, '../../tests/fixtures/opencode/extension-turn.json'), 'utf8'),
    ) as { events: { type: string; properties: Record<string, unknown> }[] }

    for (const event of fixture.events) {
      server.emit(event.type, JSON.parse(JSON.stringify(event.properties).replaceAll('ses_ext_live', sessionId)))
    }

    const answer = await result
    expect(answer.text).toBe('"hello world"라는 한 줄만 포함되어 있습니다.')
    expect(pieces.join('')).toBe(answer.text)
  })

  it('글 파트가 바뀌면 빈 줄로 가르고, 조각을 이어 붙인 것과 최종 글이 같다', async () => {
    const server = fakeOpencode()
    const { result, pieces, sessionId } = await started(server)
    server.emit('message.part.delta', { sessionID: sessionId, partID: 'a', field: 'text', delta: '읽겠습니다' })
    server.emit('message.part.delta', { sessionID: sessionId, partID: 'b', field: 'text', delta: '결과' })
    server.emit('session.idle', { sessionID: sessionId })

    await expect(result).resolves.toEqual({ text: '읽겠습니다\n\n결과' })
    expect(pieces.join('')).toBe('읽겠습니다\n\n결과')
  })

  // 끊기는 idle 을 기다리지 않는다(F7). 그래서 끊은 턴의 idle 이 **다음 실행의 새 스트림**에 먼저 닿을 수 있다 —
  // 그걸로 닫으면 다음 실행이 묻기도 전에 빈 답으로 끝난다
  it('묻기 전에 온 제 세션 idle 로는 끝나지 않는다', async () => {
    const server = fakeOpencode(['ses_old'], [['session.idle', { sessionID: 'ses_old' }]])
    const { result, state } = await started(server, makeRuns(server, memoryLedger({ 'ext-a|p1': 'ses_old' })))
    expect(state.settled).toBe(false)

    server.emit('message.part.delta', { sessionID: 'ses_old', partID: 'a', field: 'text', delta: '새 답' })
    server.emit('session.idle', { sessionID: 'ses_old' })
    await expect(result).resolves.toEqual({ text: '새 답' })
  })

  it('세션 오류는 사유와 함께 거부된다', async () => {
    const server = fakeOpencode()
    const { result, sessionId } = await started(server)
    server.emit('session.error', { sessionID: sessionId, error: { name: 'APIError', data: { message: '모델 404' } } })
    server.emit('session.idle', { sessionID: sessionId })

    await expect(result).rejects.toThrow('ai.run: 모델 404')
  })
})

describe('그래도 온 승인·질문은 곧바로 거절한다 (F5)', () => {
  it('제 세션 것만 거절하고 사용자 것은 건드리지 않는다', async () => {
    const server = fakeOpencode()
    const { sessionId } = await started(server)

    server.emit('permission.asked', { id: 'per_ext', sessionID: sessionId, permission: 'bash', patterns: ['ls'] })
    server.emit('question.asked', { id: 'que_ext', sessionID: sessionId, questions: [{ question: '?' }] })
    server.emit('permission.asked', { id: 'per_user', sessionID: 'ses_user', permission: 'bash', patterns: ['ls'] })
    server.emit('question.asked', { id: 'que_user', sessionID: 'ses_user', questions: [{ question: '?' }] })
    await settle()

    const replies = server.calls.filter((call) => /^\/(permission|question)\//.test(call.path))
    expect(replies).toEqual([
      { method: 'POST', path: '/permission/per_ext/reply', body: { reply: 'reject' } },
      { method: 'POST', path: '/question/que_ext/reject', body: {} },
    ])
  })
})

describe('한 세션에 하나만 (F6)', () => {
  it('도는 중에 같은 확장·프로젝트로 또 부르면 busy 로 거부하고, 다른 프로젝트는 돈다', async () => {
    const server = fakeOpencode()
    const { runs, result, sessionId } = await started(server)

    await expect(runs.run(request('ext-a', 'p1', 'run-2'), () => {})).rejects.toThrow('busy')
    const other = runs.run(request('ext-a', 'p2', 'run-3'), () => {})
    await settle()
    expect(server.paths('POST')).toContain('/session/ses_ext2/prompt_async')

    server.emit('session.idle', { sessionID: sessionId })
    server.emit('session.idle', { sessionID: 'ses_ext2' })
    await result
    await other
    // 끝나면 풀린다
    const next = runs.run(request('ext-a', 'p1', 'run-4'), () => {})
    await settle()
    server.emit('session.idle', { sessionID: sessionId })
    await expect(next).resolves.toEqual({ text: '' })
  })
})

describe('끊기 (F7)', () => {
  it('프롬프트 뒤에 끊으면 그 세션을 abort 하고 취소 사유로 거부된다 — 남의 확장은 못 끊는다', async () => {
    const server = fakeOpencode()
    const { runs, result, state, sessionId } = await started(server)

    runs.cancel('ext-b', 'run-1')
    await settle()
    expect(state.settled).toBe(false)

    runs.cancel('ext-a', 'run-1')
    await expect(result).rejects.toThrow(AI_RUN_CANCELLED)
    expect(server.paths('POST')).toContain(`/session/${sessionId}/abort`)
  })

  it('세션을 세우는 중에 끊으면 프롬프트를 보내지 않는다', async () => {
    const server = fakeOpencode()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slow = new ExtensionAiRuns({
      sessions: memoryLedger(),
      server: async () => {
        await gate
        return { url: 'http://127.0.0.1:4096', directory: '/tmp/p1' }
      },
      fetchImpl: server.fetchImpl,
    })
    const result = slow.run(request(), () => {})
    slow.cancel('ext-a', 'run-1')
    release()

    await expect(result).rejects.toThrow(AI_RUN_CANCELLED)
    await settle()
    expect(server.paths('POST').some((path) => path.endsWith('/prompt_async'))).toBe(false)
  })
})
