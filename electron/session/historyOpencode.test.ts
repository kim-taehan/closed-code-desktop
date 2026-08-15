import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeOpencodeServer } from '../../tests/fake-opencode/FakeOpencodeServer'
import type { FakeMessage } from '../../tests/fake-opencode/fakeHistory'
import { ProjectSession } from './projectSession'
import type { ChatHistoryState } from './chatHistory'
import type { ChatSnapshotPayload } from '../../shared/ipc/channels'

// 대화 이력을 **위층까지 통째로** 태워 본다 (어댑터 단위 시험은 `electron/opencode/chatHistory.test.ts`).
//
// 단위 시험이 겨누는 것은 봉투의 모양이고, 여기가 겨누는 것은 **그 봉투가 실제로 먹히는가**다.
// 둘은 다르다: `session/*` 과 렌더러를 안 고치는 것이 이 작업의 전제라, 어댑터가 만든 봉투를
// 위층이 그대로 받아 화면 상태로 바꾸지 못하면 매핑이 아무리 맞아도 화면은 빈 채다.
//
// 이력은 **davis 때 없던 위험을 하나 진다**: `GET /session` 은 서버 전역이라 `?directory=` 를
// 빼면 다른 프로젝트 대화 목록이 그대로 온다. 그래서 여기서도 두 프로젝트를 같은 서버에
// 붙인다 (`multiSession.test.ts` 와 같은 이유, 다른 표면).

interface Fixture {
  session: ProjectSession
  history: ChatHistoryState[]
  snapshots: ChatSnapshotPayload[]
}

function record(baseUrl: string, workspacePath: string): Fixture {
  const history: ChatHistoryState[] = []
  const snapshots: ChatSnapshotPayload[] = []
  const session = new ProjectSession(
    { workspacePath, opencodeUrl: baseUrl },
    {
      onState: () => {},
      onTurnEvent: () => {},
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onPermissionMode: () => {},
      onWorkingDir: () => {},
      onHistoryState: (state) => history.push(state),
      onReviewState: () => {},
      onMcpState: () => {},
      onModelState: () => {},
      onNotification: () => {},
    },
  )
  return { session, history, snapshots }
}

/** 지난 대화 한 판 — 질문 하나에 assistant 메시지 둘 (도구 → 답변). 실물이 그 모양이다. */
function pastChat(): FakeMessage[] {
  return [
    { info: { id: 'msg_u', role: 'user' }, parts: [{ id: 'p_u', type: 'text', text: '이 파일 열어줘' }] },
    {
      info: { id: 'msg_a1', role: 'assistant' },
      parts: [
        { id: 'p_s1', type: 'step-start' },
        {
          id: 'p_t',
          type: 'tool',
          callID: 'call_0',
          tool: 'open_file',
          state: { status: 'completed', input: { path: 'README.md' }, output: '열었습니다' },
        },
        { id: 'p_f1', type: 'step-finish', reason: 'tool-calls' },
      ],
    },
    {
      info: { id: 'msg_a2', role: 'assistant' },
      parts: [
        { id: 'p_s2', type: 'step-start' },
        { id: 'p_x', type: 'text', text: '열었습니다.' },
        { id: 'p_f2', type: 'step-finish', reason: 'stop' },
      ],
    },
  ]
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

async function connect(workspacePath = '/tmp/alpha'): Promise<Fixture> {
  await server.start()
  const fixture = record(server.baseUrl, workspacePath)
  sessions.push(fixture.session)
  await fixture.session.start()
  return fixture
}

function entriesOf(states: ChatHistoryState[]): ChatHistoryState['entries'] {
  return states.at(-1)?.entries ?? []
}

describe('이력 목록 (M1)', () => {
  it('붙으면 이 프로젝트의 지난 대화가 목록에 뜬다', async () => {
    const fixture = await connect()
    await vi.waitFor(() => expect(entriesOf(fixture.history).length).toBeGreaterThan(0))
    // 핸드셰이크가 만든 세션이 곧 이 대화다 — 「새 대화」가 또 만들지 않는다
    expect(entriesOf(fixture.history)[0]?.chatId).toMatch(/^ses_fake/)
  })

  /**
   * 붙을 때마다 세션이 둘씩 생기면 목록이 빈 대화로 불어나고, 무엇보다 **첫 질문이
   * 버려진 세션으로 나간다** (`opencode/chatHistory.ts` 의 addChat 주석). 목록 길이로 잰다.
   */
  it('붙는 것만으로 세션이 늘지 않는다 — 새 대화는 방금 만든 세션을 쓴다', async () => {
    const fixture = await connect()
    await vi.waitFor(() => expect(entriesOf(fixture.history).length).toBeGreaterThan(0))
    expect(server.calls.filter((call) => call.url === '/api/session')).toHaveLength(1)
    expect(entriesOf(fixture.history)).toHaveLength(1)
  })

  /**
   * `/session` 은 서버 전역이다. 질의에서 `?directory=` 가 빠지면 **남의 프로젝트 대화 목록이
   * 그대로 뜬다** — 제목까지 보인다. `/event` 를 sessionID 로 거르는 것과 같은 성질의 자리다.
   */
  it('다른 프로젝트의 대화는 목록에 오지 않는다', async () => {
    await server.start()
    const alpha = record(server.baseUrl, '/tmp/alpha')
    const beta = record(server.baseUrl, '/tmp/beta')
    sessions.push(alpha.session, beta.session)
    await Promise.all([alpha.session.start(), beta.session.start()])

    await vi.waitFor(() => expect(entriesOf(alpha.history).length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(entriesOf(beta.history).length).toBeGreaterThan(0))
    // 서버는 세션 둘을 알지만 각자 자기 것 하나만 본다
    expect(entriesOf(alpha.history)).toHaveLength(1)
    expect(entriesOf(beta.history)).toHaveLength(1)
    expect(entriesOf(alpha.history)[0]?.chatId).not.toBe(entriesOf(beta.history)[0]?.chatId)
  })

  it('제목과 시각이 실려 온다 — 목록이 날짜를 그릴 수 있다', async () => {
    const fixture = await connect()
    await vi.waitFor(() => expect(entriesOf(fixture.history).length).toBeGreaterThan(0))
    const chatId = entriesOf(fixture.history)[0]!.chatId
    server.history.seed(chatId, '지난 대화', pastChat())
    fixture.session.requestHistoryList()

    await vi.waitFor(() => expect(entriesOf(fixture.history)[0]?.title).toBe('지난 대화'))
    // 화면은 `Date.parse` 로 읽는다 — epoch ms 를 그대로 실으면 여기서 NaN 이 된다
    expect(Number.isFinite(Date.parse(entriesOf(fixture.history)[0]?.updatedAt ?? ''))).toBe(true)
  })
})

describe('이력 열기 (M2)', () => {
  async function seeded(): Promise<{ fixture: Fixture; chatId: string }> {
    const fixture = await connect()
    await vi.waitFor(() => expect(entriesOf(fixture.history).length).toBeGreaterThan(0))
    const chatId = entriesOf(fixture.history)[0]!.chatId
    server.history.seed(chatId, '지난 대화', pastChat())
    return { fixture, chatId }
  }

  function contentsOf(snapshots: ChatSnapshotPayload[]): string {
    return (snapshots.at(-1)?.messages ?? []).map((message) => message.content).join('|')
  }

  it('과거 대화를 열면 질문과 답이 화면에 되살아난다', async () => {
    const { fixture, chatId } = await seeded()
    fixture.session.loadHistory(chatId)

    await vi.waitFor(() => expect(contentsOf(fixture.snapshots)).toContain('열었습니다.'))
    // 사용자 질문도 함께 — 답만 뜨면 무엇을 물었는지 알 수 없다
    expect(contentsOf(fixture.snapshots)).toContain('이 파일 열어줘')
  })

  /**
   * 로딩이 안 풀리면 화면이 영영 도는 것으로 끝나지 않는다 — 재생 중 인터럽트 억제
   * (`ReplayGate`)도 함께 안 풀려, 그 다음 **라이브** 대화의 승인 카드까지 삼켜진다.
   */
  it('재생이 끝나면 로딩이 풀린다', async () => {
    const { fixture, chatId } = await seeded()
    fixture.session.loadHistory(chatId)

    await vi.waitFor(() => expect(fixture.history.at(-1)?.loading).toBe(false))
    expect(fixture.history.at(-1)?.current?.chatId).toBe(chatId)
    // 재생 중에는 loading 이 켜져 있었어야 한다 — 라이브로 착각하지 않게
    expect(fixture.history.some((state) => state.loading)).toBe(true)
  })

  /**
   * opencode 에서 대화의 정체는 **세션 그 자체**다. 어댑터가 세션을 갈아타지 않으면 이어 말한
   * 질문이 지금 붙어 있는 세션으로 나가고, 화면에는 아무 일도 안 일어난 것처럼 보인다.
   *
   * ⚠️ **일부러 대화를 둘 만든다.** 세션이 하나뿐이면 「연 대화」와 「지금 세션」이 같은
   * id 라, 갈아타기를 통째로 지워도 이 시험이 초록으로 통과한다.
   */
  it('연 대화에 이어 말하면 그 세션으로 나간다', async () => {
    const { fixture, chatId: first } = await seeded()
    // 첫 대화에 말을 걸어 「비어 있지 않게」 만든 뒤 새 대화로 옮긴다 — 이제 세션이 둘이다
    fixture.session.send('첫 질문')
    await vi.waitFor(() => expect(server.calls.some((call) => call.url.endsWith('/prompt_async'))).toBe(true))
    fixture.session.reset()
    await vi.waitFor(() => expect(entriesOf(fixture.history)).toHaveLength(2))

    fixture.session.loadHistory(first)
    await vi.waitFor(() => expect(fixture.history.at(-1)?.loading).toBe(false))

    fixture.session.send('이어서 해줘')
    await vi.waitFor(() => {
      const prompts = server.calls.filter((call) => call.url.endsWith('/prompt_async'))
      expect(prompts).toHaveLength(2)
      expect(prompts.at(-1)?.url).toBe(`/session/${first}/prompt_async`)
    })
  })

  it('없는 대화를 열어도 로딩은 풀린다', async () => {
    const fixture = await connect()
    await vi.waitFor(() => expect(entriesOf(fixture.history).length).toBeGreaterThan(0))
    fixture.session.loadHistory('ses_없는것')
    await vi.waitFor(() => expect(fixture.history.at(-1)?.loading).toBe(false))
  })
})

describe('이력 지우기·제목', () => {
  it('지우면 목록에서 사라진다', async () => {
    const fixture = await connect()
    await vi.waitFor(() => expect(entriesOf(fixture.history).length).toBeGreaterThan(0))
    fixture.session.removeHistory(entriesOf(fixture.history)[0]!.chatId)
    await vi.waitFor(() => expect(entriesOf(fixture.history)).toHaveLength(0))
  })

  it('제목을 바꾸면 서버에도 남는다 — 다시 받아도 새 제목이다', async () => {
    const fixture = await connect()
    await vi.waitFor(() => expect(entriesOf(fixture.history).length).toBeGreaterThan(0))
    const chatId = entriesOf(fixture.history)[0]!.chatId
    fixture.session.renameHistory(chatId, '새 이름')

    await vi.waitFor(() => expect(server.calls.some((call) => call.method === 'PATCH')).toBe(true))
    fixture.session.requestHistoryList()
    await vi.waitFor(() => expect(entriesOf(fixture.history)[0]?.title).toBe('새 이름'))
  })
})
