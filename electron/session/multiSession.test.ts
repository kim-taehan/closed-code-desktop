import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeOpencodeServer } from '../../tests/fake-opencode/FakeOpencodeServer'
import { ProjectSession } from './projectSession'
import type { ChatSnapshotPayload, SessionStatePayload, TurnEvent } from '../../shared/ipc/channels'

// P3-1 관문: 프로젝트마다 세션이 하나씩 돌아도 서로 새지 않는다.
//
// 이게 깨지면 A 의 응답이 B 화면에 뜨거나, B 에서 보낸 질문이 A 로 간다.
//
// **opencode 에서는 이게 davis 때보다 더 위험하다.** davis 는 프로젝트마다 별도 runtime·소켓이라
// 물리적으로 갈렸지만, opencode 는 서버 하나에 세션이 여럿이고 `/api/event` 는 **서버 전역**이다 —
// 남의 턴 이벤트가 내 스트림으로 그대로 들어온다. 격리는 오직 어댑터의 sessionID 필터뿐이다.
// 그래서 아래 테스트들은 **두 세션을 같은 서버에 붙여** 그 필터를 실제로 겨눈다.

interface Recorder {
  session: ProjectSession
  states: SessionStatePayload[]
  events: TurnEvent[]
  snapshots: ChatSnapshotPayload[]
}

function record(baseUrl: string, workspacePath: string): Recorder {
  const states: SessionStatePayload[] = []
  const events: TurnEvent[] = []
  const snapshots: ChatSnapshotPayload[] = []

  const session = new ProjectSession(
    { workspacePath, opencodeUrl: baseUrl },
    {
      onState: (state) => states.push(state),
      onTurnEvent: (event) => events.push(event),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onPermissionMode: () => {},
      onWorkingDir: () => {},
      onHistoryState: () => {},
      onReviewState: () => {},
      onMcpState: () => {},
      onModelState: () => {},
      onNotification: () => {},
    },
  )
  return { session, states, events, snapshots }
}

function textOf(snapshots: ChatSnapshotPayload[]): string {
  const last = snapshots.at(-1)
  return (last?.messages ?? []).map((message) => message.content).join('')
}

let server: FakeOpencodeServer
let sessions: ProjectSession[] = []

beforeEach(() => {
  server = new FakeOpencodeServer()
  sessions = []
})

afterEach(async () => {
  await Promise.all(sessions.map((session) => session.dispose()))
  await server.stop()
})

/** 두 프로젝트를 같은 서버에 붙인다 */
async function twoProjects() {
  await server.start()
  const a = record(server.baseUrl, '/tmp/alpha')
  const b = record(server.baseUrl, '/tmp/beta')
  sessions.push(a.session, b.session)
  await Promise.all([a.session.start(), b.session.start()])
  return { a, b }
}

describe('세션 격리', () => {
  it('두 프로젝트가 각자 세션을 열고 ready 가 된다', async () => {
    const { a, b } = await twoProjects()

    expect(a.states.at(-1)?.handshake.stage).toBe('ready')
    expect(b.states.at(-1)?.handshake.stage).toBe('ready')

    // 세션 생성이 두 번 — 프로젝트마다 하나씩
    const created = server.calls.filter((call) => call.url === '/api/session')
    expect(created).toHaveLength(2)
  })

  it('각 세션이 자기 워크스페이스를 디렉터리로 넘긴다', async () => {
    await twoProjects()

    const directories = server.calls
      .filter((call) => call.url === '/api/session')
      .map((call) => (call.body as { location?: { directory?: string } })?.location?.directory)
    expect(directories).toEqual(expect.arrayContaining(['/tmp/alpha', '/tmp/beta']))
  })

  it('A 에 보낸 질문이 B 로 가지 않는다', async () => {
    const { a } = await twoProjects()
    a.session.send('A 의 질문')

    const prompts = () => server.calls.filter((call) => call.url.endsWith('/prompt'))
    await vi.waitFor(() => expect(prompts()).toHaveLength(1))
    expect((prompts()[0]?.body as { prompt?: { text?: string } })?.prompt?.text).toBe('A 의 질문')
  })

  it('A 의 응답이 B 의 화면에 섞이지 않는다 — /api/event 는 전역이다', async () => {
    const { a, b } = await twoProjects()
    a.session.send('A 에게')

    await vi.waitFor(() => expect(textOf(a.snapshots)).toContain('답: A 에게'))

    // B 도 같은 스트림으로 A 의 이벤트를 **받았지만** 걸러냈어야 한다
    expect(textOf(b.snapshots)).not.toContain('답: A 에게')
    expect(b.events.filter((event) => event.type === 'text')).toHaveLength(0)
  })

  it('한쪽을 접어도 다른 쪽은 계속 돈다 — 서버는 공유물이다', async () => {
    const { a, b } = await twoProjects()

    await a.session.dispose()

    b.session.send('B 에게')
    await vi.waitFor(() => expect(textOf(b.snapshots)).toContain('답: B 에게'))
    expect(b.states.at(-1)?.handshake.stage).toBe('ready')
  })
})
