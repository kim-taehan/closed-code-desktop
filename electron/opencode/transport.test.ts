import { describe, expect, it } from 'vitest'
import { Handshake } from '../session/handshake'
import { OpencodeTransport } from './transport'
import { fakeServer, makeTransport, tick } from './transportTestKit'

// 이 파일의 목적은 조각 검증이 아니라 **실제 Handshake 가 이 어댑터로 4단계를 통과하는가** 다.
// 위층을 고치지 않는 것이 부패방지 계층의 계약이므로, 위층 진짜 코드를 그대로 물려 확인한다.


describe('핸드셰이크 4단계', () => {
  it('server.connected 만으로 auth·workspace 를 합성해 ready 까지 간다', async () => {
    const server = fakeServer()
    const transport = makeTransport(server)
    const handshake = new Handshake(transport, {
      workspacePath: '/tmp/proj',
      projectName: 'proj',
    })

    const done = handshake.run()
    transport.open()
    await tick()

    // opencode 가 SSE 를 열자마자 보내는 첫 이벤트
    server.emit('server.connected')
    await tick()

    await expect(done).resolves.toBeUndefined()
    expect(handshake.state.stage).toBe('ready')

    // 워크스페이스는 opencode 세션 생성으로 옮겨졌다
    const created = server.find((call) => call.url.endsWith('/api/session') && call.method === 'POST')
    expect(created?.body).toEqual({ location: { directory: '/tmp/proj' } })

    transport.close()
  })

  it('세션 응답에 id 가 없으면 조용히 넘어가지 않고 오류를 화면까지 올린다', async () => {
    // 회귀: `/api/*` 응답이 `{data:...}` 로 감싸인 것을 몰라 id 가 undefined 로 새고,
    // 증상이 "핸드셰이크는 ready 인데 채팅 무응답" 으로만 나타났다.
    const server = fakeServer()
    const original = server.fetchImpl
    const brokenFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/session') && (init?.method ?? 'GET') === 'POST') {
        return new Response(JSON.stringify({ data: { projectID: 'global' } }), { status: 200 })
      }
      return original(input as never, init as never)
    }) as unknown as typeof fetch

    const transport = new OpencodeTransport({
      baseUrl: 'http://127.0.0.1:4096',
      fetchImpl: brokenFetch,
      autoReconnect: false,
    })
    const seen: string[] = []
    transport.onMessage((raw) => seen.push(raw))
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()

    transport.send(
      JSON.stringify({
        kind: 'workspace',
        action: 'workspace_sync',
        reqId: 'r',
        data: { workspace: { workspacePath: '/tmp/p' } },
      }),
    )
    await tick()

    expect(seen.some((raw) => raw.includes('id 가 없습니다'))).toBe(true)
    expect(seen.some((raw) => raw.includes('workspace_state'))).toBe(false)
    transport.close()
  })

  it('workspacePath 가 비면 세션을 만들지 않고 오류로 알린다', async () => {
    const server = fakeServer()
    const transport = makeTransport(server)
    const seen: string[] = []
    transport.onMessage((raw) => seen.push(raw))
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()

    transport.send(
      JSON.stringify({ kind: 'workspace', action: 'workspace_sync', reqId: 'r', data: { workspace: {} } }),
    )
    await tick()

    expect(seen.some((raw) => raw.includes('NO_WORKSPACE'))).toBe(true)
    expect(server.find((call) => call.url.endsWith('/api/session') && call.method === 'POST')).toBeUndefined()
    transport.close()
  })
})

describe('채팅', () => {
  async function readySession() {
    const server = fakeServer()
    const transport = makeTransport(server)
    const frames: string[] = []
    transport.onMessage((raw) => frames.push(raw))
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()
    transport.send(
      JSON.stringify({
        kind: 'workspace',
        action: 'workspace_sync',
        reqId: 'r',
        data: { workspace: { workspacePath: '/tmp/proj' } },
      }),
    )
    await tick()
    return { server, transport, frames }
  }

  it('chat_request 는 stream_start 를 먼저 내고 prompt 를 쏜다', async () => {
    const { server, transport, frames } = await readySession()
    transport.send(
      JSON.stringify({ kind: 'chat', action: 'chat_request', reqId: 'r', data: { query: '안녕' } }),
    )
    await tick()

    const start = frames.map((f) => JSON.parse(f)).find((f) => f.action === 'stream_start')
    expect(start).toBeDefined()
    expect(typeof start.streamId).toBe('string')

    // **레거시 세대로 간다** — 신규 `/api/session/:id/prompt` 는 LLM 요청에 MCP 도구를
    // 안 실어서다 (`legacyEvents.ts` 머리말). URL 문자열 자체를 단언하는 이유는
    // 세대를 잘못 짝지어도 목 서버가 200 을 주기 때문이다.
    const prompt = server.find((call) => call.url.endsWith('/prompt_async'))
    expect(prompt?.url).toBe('http://127.0.0.1:4096/session/ses_fake/prompt_async')
    expect(prompt?.body).toEqual({ parts: [{ type: 'text', text: '안녕' }] })
    transport.close()
  })

  // ⚠️ **이 테스트는 경보기다.** 확장 질의를 사용자 대화와 같은 세션으로 돌리기로 한 결정
  // (설계 2026-08-13-extension-ipc-redesign)의 근거가 여기 걸려 있다.
  //
  // davis 시절 확장은 **곁길**(`electron/agentLane/`, 지금은 삭제)로 물었다. 사유는 하나였다 —
  // `ChatSession` 이 들어오는 프레임의 `chatId` 로 자기 것을 갈아끼워서, 한 세션을 나눠 쓰면
  // **사용자 대화가 확장 쪽으로 이어졌다**(`chatSession.ts:210`). opencode 어댑터는 `chatId` 를
  // 아예 안 싣기 때문에 그 위험이 없고, 그래서 곁길을 없앨 수 있다.
  //
  // 여기가 빨개지면 곁길을 없앤 근거가 무너진 것이다. 프레임에 chatId 를 더하기 전에
  // 확장 질의 격리를 어떻게 할지부터 다시 정해야 한다.
  it('어댑터가 내는 프레임에는 chatId 가 없다 — 세션을 나눠 써도 대화가 섞이지 않는 근거', async () => {
    const { server, transport, frames } = await readySession()
    transport.send(
      JSON.stringify({ kind: 'chat', action: 'chat_request', reqId: 'r', data: { query: '안녕' } }),
    )
    await tick()
    // 한 턴을 통째로 흘린다 — 시작·본문·도구·종료 어디서도 붙지 않아야 한다
    server.emit('session.next.step.started', { sessionID: 'ses_fake' })
    server.emit('session.next.text.delta', { sessionID: 'ses_fake', text: '반가워' })
    server.emit('session.next.tool.input.started', { sessionID: 'ses_fake', name: 'read', callID: 'c1' })
    server.emit('session.next.tool.success', { sessionID: 'ses_fake', callID: 'c1', output: 'ok' })
    server.emit('session.next.step.ended', { sessionID: 'ses_fake', finish: 'stop' })
    await tick()

    expect(frames.length).toBeGreaterThan(0)
    for (const raw of frames) {
      expect(JSON.parse(raw), raw.slice(0, 120)).not.toHaveProperty('chatId')
    }
    transport.close()
  })

  it('세션 전에 보낸 chat_request 는 오류로 되돌려준다', async () => {
    const server = fakeServer()
    const transport = makeTransport(server)
    const frames: string[] = []
    transport.onMessage((raw) => frames.push(raw))
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()

    transport.send(JSON.stringify({ kind: 'chat', action: 'chat_request', reqId: 'r', data: { query: 'x' } }))
    await tick()
    expect(frames.some((f) => f.includes('NO_SESSION'))).toBe(true)
    transport.close()
  })

  /**
   * ⚠️ **이 단언도 뒤집혔다** — 예전 이름은 "interrupt 로 간다 (abort 가 아니다)" 였다.
   * 그때는 프롬프트가 신규 세대였고, 신규 턴은 `/api/…/interrupt` 로만 끊겼다.
   * 레거시 턴에 그걸 넣으면 **204 를 주고 아무 일도 안 일어난다** (1.18.18 실측) —
   * 조용히 무시되므로 증상은 "중단 버튼이 안 먹는다" 뿐이다.
   */
  it('stream_cancel 은 레거시 abort 로 간다 (interrupt 가 아니다)', async () => {
    const { server, transport } = await readySession()
    transport.send(JSON.stringify({ kind: 'chat', action: 'stream_cancel', reqId: 'r', data: {} }))
    await tick()
    expect(server.find((call) => call.url.endsWith('/abort'))?.url).toBe(
      'http://127.0.0.1:4096/session/ses_fake/abort',
    )
    expect(server.find((call) => call.url.endsWith('/interrupt'))).toBeUndefined()
    transport.close()
  })

  // 중단 뒤 opencode 가 내는 것은 `step.ended` 가 아니라 `step.failed` 다 (1.18.18 실측).
  // 이걸 안 옮기면 취소한 턴을 닫는 것은 TurnGate 의 5초 강제 종단뿐이고, 그 5초가
  // 사용자에게는 "중단 버튼이 무시됐다" 로 보인다.
  it('중단 뒤 step.failed 는 턴을 닫는다 — 5초 강제 종단을 기다리지 않는다', async () => {
    const { server, transport, frames } = await readySession()
    transport.send(JSON.stringify({ kind: 'chat', action: 'chat_request', reqId: 'r', data: { query: '길게' } }))
    await tick()
    transport.send(JSON.stringify({ kind: 'chat', action: 'stream_cancel', reqId: 'r', data: {} }))
    await tick()

    server.emit('session.next.step.failed', {
      sessionID: 'ses_fake',
      error: { type: 'unknown', message: 'Provider turn interrupted' },
    })
    await tick()

    const ends = frames.map((f) => JSON.parse(f)).filter((f) => f.action === 'stream_end')
    expect(ends).toHaveLength(1)
    // 사용자가 끊은 것은 실패가 아니다 — failed 를 실으면 에러 말풍선이 뜬다
    expect(ends[0].data.failed).toBeUndefined()
    transport.close()
  })

  // 조용히 버리면 화면에는 아무 일도 안 일어나고, 사용자는 버튼이 무시됐다고 읽는다.
  it('세션 없이 온 stream_cancel 은 오류를 화면까지 올린다', async () => {
    const server = fakeServer()
    const transport = makeTransport(server)
    const frames: string[] = []
    transport.onMessage((raw) => frames.push(raw))
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()

    transport.send(JSON.stringify({ kind: 'chat', action: 'stream_cancel', reqId: 'r', data: {} }))
    await tick()

    expect(frames.some((raw) => raw.includes('중단 요청을 보내지 못했습니다'))).toBe(true)
    expect(server.find((call) => call.url.endsWith('/interrupt'))).toBeUndefined()
    transport.close()
  })

  it('다른 세션의 이벤트는 걸러낸다 — /event 는 서버 전역이다', async () => {
    const { server, transport, frames } = await readySession()
    const before = frames.length
    server.emit('session.idle', { sessionID: 'ses_다른창' })
    await tick()
    expect(frames.length).toBe(before)
    transport.close()
  })
})

describe('승인 응답 매핑', () => {
  async function approve(body: Record<string, unknown>) {
    const server = fakeServer()
    const transport = makeTransport(server)
    transport.open()
    await tick()
    server.emit('server.connected')
    await tick()
    transport.send(
      JSON.stringify({
        kind: 'workspace',
        action: 'workspace_sync',
        reqId: 'r',
        data: { workspace: { workspacePath: '/tmp/p' } },
      }),
    )
    await tick()
    transport.send(JSON.stringify({ kind: 'chat', action: 'tool_approval_response', reqId: 'r', data: body }))
    await tick()
    const call = server.find((c) => c.url.includes('/permission/'))
    transport.close()
    return call
  }

  it('거부 → reject', async () => {
    expect((await approve({ requestId: 'per_1', approved: false }))?.body).toEqual({ reply: 'reject' })
  })

  it('한 번 승인 → once', async () => {
    expect((await approve({ requestId: 'per_1', approved: true }))?.body).toEqual({ reply: 'once' })
  })

  it('범위 승인(session_allow) → always — opencode 는 범위 구분이 없다', async () => {
    const call = await approve({ requestId: 'per_1', approved: true, followUp: 'session_allow' })
    expect(call?.body).toEqual({ reply: 'always' })
    expect(call?.url).toBe('http://127.0.0.1:4096/api/session/ses_fake/permission/per_1/reply')
  })
})
