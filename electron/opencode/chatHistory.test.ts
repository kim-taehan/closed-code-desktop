import { describe, expect, it, vi } from 'vitest'
import { Action, Kind } from '../../shared/protocol/kinds'
import { parseHistoryList, parseHistoryState } from '../../shared/protocol/chatHistory'
import { chatHistoryFrame } from './chatHistory'
import type { Frame } from './translate'

// 실측 페이로드(opencode 1.18.18, 2026-08-15) → davis `chat_history` 봉투.
//
// 아래 두 건은 `GET /session?directory=` 가 준 항목에서 목록이 쓰는 필드만 남긴 것이다.
// **`time` 이 epoch ms 숫자라는 점이 그대로 옮겨져 있다** — 여기를 문자열 fixture 로 바꾸면
// 이 파일의 날짜 시험이 통째로 헛초록이 된다 (화면은 `Date.parse` 로 읽는다).
const SESSIONS = [
  { id: 'ses_ffbb7f66', title: '프로젝트 분석', directory: '/proj', time: { created: 1786778225117, updated: 1786778241150 } },
  { id: 'ses_ffbd2cee', title: '인사', directory: '/proj', time: { created: 1786777558000, updated: 1786777628988 } },
]

function client(overrides: Record<string, unknown> = {}) {
  return {
    listSessions: vi.fn(async () => SESSIONS),
    sessionMessages: vi.fn(async () => []),
    deleteSession: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    createSession: vi.fn(async () => ({ id: 'ses_new', model: null })),
    ...overrides,
  } as never
}

async function run(
  action: string,
  data: Record<string, unknown> = {},
  api = client(),
  { directory = '/proj', emptySession = null }: { directory?: string; emptySession?: string | null } = {},
) {
  const frames: Frame[] = []
  const deps = { client: api, directory, emptySession }
  const next = await chatHistoryFrame(deps, action, data, (frame) => frames.push(frame))
  return { frames, next, api: api as unknown as Record<string, { mock: { calls: unknown[][] } }> }
}

describe('chat_history_list', () => {
  it('세션 목록을 davis 봉투로 답한다', async () => {
    const { frames } = await run(Action.CHAT_HISTORY_LIST)
    expect(frames).toHaveLength(1)
    expect(frames[0]?.['kind']).toBe(Kind.CHAT_HISTORY)
    expect(frames[0]?.['action']).toBe(Action.CHAT_HISTORY_LIST)
  })

  /**
   * 이 도메인에는 camelCase 별칭이 없다 (`shared/protocol/chatHistory.ts` 머리말).
   * 어기면 오류 없이 **빈 목록**이 뜬다 — `toHistoryEntry` 가 `chat_id` 없는 항목을 버린다.
   * 그래서 파서를 실제로 태워서 잰다. 봉투를 직접 들여다보면 이 규칙을 못 지킨다.
   */
  it('payload 는 snake_case 다 — 위층 파서를 그대로 태워 잰다', async () => {
    const { frames } = await run(Action.CHAT_HISTORY_LIST)
    const entries = parseHistoryList(frames[0]?.['data'])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ chatId: 'ses_ffbb7f66', title: '프로젝트 분석' })
  })

  /**
   * opencode 는 epoch ms 숫자를 주고 화면은 `Date.parse(iso)` 로 읽는다
   * (`HistoryList.tsx` 의 `formatDate`). 숫자를 문자열로만 바꿔 실으면 NaN 이라
   * **날짜만 조용히 사라진다** — 목록은 멀쩡히 뜨므로 눈으로는 안 잡힌다.
   */
  it('시각은 ISO 문자열로 옮긴다 — epoch ms 를 그대로 실으면 날짜가 사라진다', async () => {
    const { frames } = await run(Action.CHAT_HISTORY_LIST)
    const entry = parseHistoryList(frames[0]?.['data'])[0]
    expect(Number.isFinite(Date.parse(entry?.updatedAt ?? ''))).toBe(true)
    expect(entry?.updatedAt).toBe(new Date(1786778241150).toISOString())
  })

  /**
   * `/session` 은 서버 전역이라 `?directory=` 를 빼면 다른 프로젝트 대화가 함께 온다
   * (실측: 없이 부르면 32건, `directory=closed-code` 로 부르면 0건). `/event` 를 sessionID 로
   * 거르는 것과 같은 자리이고 (`transport.ts`), 여기서 막는 것은 이 인자 하나뿐이다.
   */
  it('목록 질의에 프로젝트를 싣는다 — 빼면 남의 대화가 뜬다', async () => {
    const { api } = await run(Action.CHAT_HISTORY_LIST)
    expect(api['listSessions']?.mock.calls[0]?.[0]).toBe('/proj')
  })

  it('제목이 없으면 짓지 않는다 — 위층이 대화 id 로 채운다', async () => {
    const api = client({ listSessions: vi.fn(async () => [{ id: 'ses_bare', time: {} }]) })
    const { frames } = await run(Action.CHAT_HISTORY_LIST, {}, api)
    expect(parseHistoryList(frames[0]?.['data'])[0]?.title).toBe('대화 ses_bare')
  })
})

describe('chat_history_load', () => {
  /**
   * **`load_complete` 가 안 나가면 두 가지가 함께 잠긴다**: 로딩 표시(`loadingChatId`)와
   * 재생 중 인터럽트 억제(`ReplayGate`). 뒤엣것이 안 풀리면 그 다음 **라이브** 대화의
   * 승인 카드까지 삼켜져, 증상이 "이력을 한 번 열면 도구 승인이 안 뜬다" 로 나타난다.
   */
  it('재생 프레임 뒤에 load_complete 를 마지막으로 낸다', async () => {
    const api = client({
      sessionMessages: vi.fn(async () => [
        { info: { id: 'm1', role: 'user' }, parts: [{ id: 'p', type: 'text', text: '안녕' }] },
      ]),
    })
    const { frames } = await run(Action.CHAT_HISTORY_LOAD, { chat_id: 'ses_ffbd2cee' }, api)
    expect(frames.at(-1)?.['action']).toBe(Action.CHAT_HISTORY_LOAD_COMPLETE)
    expect(parseHistoryState(frames.at(-1)?.['data'])?.chatId).toBe('ses_ffbd2cee')
    expect(frames.some((frame) => frame['action'] === Action.CHAT_REQUEST)).toBe(true)
  })

  it('조회가 실패해도 load_complete 는 낸다 — 안 내면 로딩이 영영 돈다', async () => {
    const api = client({
      sessionMessages: vi.fn(async () => {
        throw new Error('HTTP 500')
      }),
    })
    const { frames } = await run(Action.CHAT_HISTORY_LOAD, { chat_id: 'ses_x' }, api)
    expect(frames.some((frame) => frame['action'] === Action.ERROR)).toBe(true)
    expect(frames.at(-1)?.['action']).toBe(Action.CHAT_HISTORY_LOAD_COMPLETE)
  })

  /**
   * opencode 에서 대화의 정체는 **세션 그 자체**다. 이 반환값을 버리면 과거 대화를 열어 놓고
   * 이어 말했을 때 답이 원래 세션에 쌓인다 — 화면에는 아무 일도 안 일어난 것처럼 보인다.
   */
  it('연 대화가 곧 다음 프롬프트가 갈 세션이다', async () => {
    const { next } = await run(Action.CHAT_HISTORY_LOAD, { chat_id: 'ses_ffbd2cee' })
    expect(next).toBe('ses_ffbd2cee')
  })
})

describe('chat_history_add / remove / rename', () => {
  /**
   * 새 대화는 **세션 생성**이다. 이 자리가 비어 있으면 「새 대화」를 눌러도 세션이 그대로라
   * 화면만 비워지고 모델은 앞 이야기를 기억한다.
   */
  it('새 대화는 세션을 새로 만들고 그 id 를 발급한다', async () => {
    const { frames, next } = await run(Action.CHAT_HISTORY_ADD)
    expect(parseHistoryState(frames[0]?.['data'])?.chatId).toBe('ses_new')
    expect(next).toBe('ses_new')
  })

  /**
   * ⚠️ **이 자리는 실제로 밟혔다.** 위층은 붙자마자 「새 대화」를 부르는데
   * (`sessionReady.primeOnFirstReady`) 그 직전에 핸드셰이크가 이미 세션을 만들어 뒀다.
   * 여기서 무조건 만들면 연결마다 세션이 둘 생기고, **그 사이에 보낸 첫 질문이 버려진 쪽으로
   * 나가** 답이 오는 이벤트를 격리 필터가 전부 버린다 — 화면이 영영 답을 못 받는다.
   * `multiSession.test.ts` 가 이걸 잡았고, 이 케이스가 그 회귀를 여기서 잠근다.
   */
  it('비어 있는 세션이 있으면 그걸 준다 — 또 만들면 붙어 있던 세션을 버린다', async () => {
    const api = client()
    const { frames, next, api: spies } = await run(Action.CHAT_HISTORY_ADD, {}, api, { emptySession: 'ses_fresh' })
    expect(spies['createSession']?.mock.calls).toHaveLength(0)
    expect(next).toBe('ses_fresh')
    expect(parseHistoryState(frames[0]?.['data'])?.chatId).toBe('ses_fresh')
  })

  it('삭제는 세션을 지우고 봉투로 알린다 — 위층이 목록을 다시 물어 온다', async () => {
    const { frames, api } = await run(Action.CHAT_HISTORY_REMOVE, { chat_id: 'ses_ffbd2cee' })
    expect(api['deleteSession']?.mock.calls[0]).toEqual(['ses_ffbd2cee', '/proj'])
    expect(frames[0]?.['action']).toBe(Action.CHAT_HISTORY_REMOVE)
  })

  it('제목 변경은 chat_history_title 로 되돌아온다', async () => {
    const { frames, api } = await run(Action.CHAT_HISTORY_RENAME, { chat_id: 'ses_1', title: '새 제목' })
    expect(api['renameSession']?.mock.calls[0]).toEqual(['ses_1', '/proj', '새 제목'])
    expect(frames[0]).toMatchObject({
      action: Action.CHAT_HISTORY_TITLE,
      data: { chat_id: 'ses_1', title: '새 제목' },
    })
  })

  it('chat_id 가 없는 요청은 아무 호출도 하지 않는다', async () => {
    const { frames, api } = await run(Action.CHAT_HISTORY_REMOVE, {})
    expect(api['deleteSession']?.mock.calls).toHaveLength(0)
    expect(frames).toHaveLength(0)
  })
})
