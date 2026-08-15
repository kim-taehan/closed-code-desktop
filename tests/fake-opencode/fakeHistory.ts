import type { ServerResponse } from 'node:http'

// 가짜 서버의 대화 이력 표면 (`FakeOpencodeServer` 에서 갈라냈다 — `fakePty.ts` 와 같은 꼴).
//
// **실물 계약을 그대로 흉내낸다** (2026-08-15 실측, opencode 1.18.18 — 실측 근거의 정본은
// `electron/opencode/historyApi.ts` 머리말):
//
//   1. **넷 다 레거시 세대이고 `{data:…}` 래핑이 없다.** 목록은 배열이 그냥 온다.
//      신규(`/api/session`)는 `{data, cursor}` 로 감싸 페이지를 나누고 내용은 대화가
//      아니라 이벤트 로그를 준다 — 여기서 감싸 버리면 어댑터가 세대를 잘못 짚어도 초록이 난다.
//   2. **`?directory=` 가 목록을 실제로 거른다.** 빼면 서버가 아는 세션이 전부 온다.
//      이게 이력의 격리 지점이라 가짜도 진짜로 걸러야 한다 — 안 그러면 남의 프로젝트
//      대화가 뜨는 결함을 이 가짜가 통과시킨다.
//   3. `POST /api/session` 으로 만든 세션이 **레거시 목록에 그대로 보인다** (실측 확인).
//      만드는 길과 읽는 길의 세대가 다른데도 같은 것을 가리킨다.
//   4. `time` 은 **epoch ms 숫자다** (ISO 문자열이 아니다). 어댑터가 ISO 로 옮기는지를
//      겨누는 자리라 여기서 문자열로 바꾸면 그 시험이 통째로 헛초록이 된다.
//   5. 삭제는 `200` 에 본문 `true`, 제목 변경(PATCH)은 `200` 이다.

/** `GET /session/:id/message` 한 건. parts 는 테스트가 필요한 만큼만 심는다. */
export interface FakeMessage {
  info: { id: string; role: string; error?: { name?: string; data?: { message?: string } } }
  parts: Record<string, unknown>[]
}

interface FakeSession {
  id: string
  directory: string
  title: string
  created: number
  messages: FakeMessage[]
}

let counter = 0

export class FakeHistoryStore {
  private readonly sessions = new Map<string, FakeSession>()

  /** `POST /api/session`. 실물처럼 id 만 돌려주고 제목은 나중에 붙는다. */
  create(directory: string): string {
    counter += 1
    const id = `ses_fake${counter}`
    this.sessions.set(id, {
      id,
      directory,
      title: `New session - ${new Date(1786778000000 + counter).toISOString()}`,
      created: 1786778000000 + counter,
      messages: [],
    })
    return id
  }

  directoryOf(id: string): string {
    return this.sessions.get(id)?.directory ?? ''
  }

  /** 테스트가 「지난 대화」를 심는다 — 실물에서는 턴이 끝나며 쌓이는 것이다. */
  seed(id: string, title: string, messages: FakeMessage[]): void {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`없는 세션에 이력을 심었다: ${id}`)
    session.title = title
    session.messages = messages
  }

  matches(method: string, url: string): boolean {
    return method !== 'POST' && /^\/session(\?|\/|$)/.test(url)
  }

  handle(method: string, url: string, body: unknown, response: ServerResponse): void {
    const [path, query = ''] = url.split('?')
    const directory = new URLSearchParams(query).get('directory')

    if (method === 'GET' && path === '/session') {
      // **`?directory=` 를 실제로 거른다** (머리말 2). 없으면 전부 준다 — 실물 그대로다.
      const listed = [...this.sessions.values()].filter((s) => directory === null || s.directory === directory)
      return json(response, 200, listed.reverse().map(toSummary))
    }

    const messages = /^\/session\/([^/]+)\/message$/.exec(path ?? '')
    if (method === 'GET' && messages) return json(response, 200, this.sessions.get(messages[1]!)?.messages ?? [])

    const one = /^\/session\/([^/]+)$/.exec(path ?? '')
    if (method === 'DELETE' && one) {
      this.sessions.delete(one[1]!)
      return json(response, 200, true)
    }
    if (method === 'PATCH' && one) {
      const session = this.sessions.get(one[1]!)
      const title = (body as { title?: unknown } | undefined)?.title
      if (session && typeof title === 'string') session.title = title
      return json(response, 200, session ? toSummary(session) : {})
    }
    json(response, 404, { message: '없는 이력 경로' })
  }
}

/** 목록 항목. **`time` 은 숫자다** (머리말 4). */
function toSummary(session: FakeSession): Record<string, unknown> {
  return {
    id: session.id,
    title: session.title,
    directory: session.directory,
    time: { created: session.created, updated: session.created + 100 },
  }
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}
