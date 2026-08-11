import type { IncomingMessage, ServerResponse } from 'node:http'

// 가짜 `/api/pty`. `FakeOpencodeServer` 가 위임한다.
//
// **실물의 계약을 그대로 흉내낸다** — 어긋난 가짜는 초록을 주면서 버그를 통과시킨다.
// 실측(1.17.18)으로 확인해 여기 못 박은 것 넷:
//
//   1. 질의 이름은 `location[directory]` 다 (OpenAPI 의 deepObject 표기가 아니라 실제 이름).
//      **없으면 서버의 cwd 로 떨어진다** — 여기서는 그것을 흉내내는 대신 빈 문자열로 갈라,
//      질의를 빠뜨린 클라이언트가 남의 pty 를 보지 못하게 한다.
//   2. 응답은 `{location, data}` 로 감싼다.
//   3. `GET /api/pty?location[directory]=A` 는 **A 의 pty 만** 준다.
//   4. **틀린 디렉토리로 하나를 물으면 404** 다.
//
// WebSocket(`/connect`)은 흉내내지 않는다 — 그쪽 프레이밍은 `socket.test.ts` 가 가짜 소켓으로
// 겨눈다. 여기서 재현할 것은 **디렉토리 격리** 하나다.

export interface FakePty {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: 'running' | 'exited'
  pid: number
  exitCode?: number
}

let counter = 0

export class FakePtyStore {
  /** 디렉토리 → 그 디렉토리의 pty 들 */
  private readonly byDirectory = new Map<string, FakePty[]>()
  /** 마지막으로 받은 크기. 테스트가 resize 가 갔는지 본다. */
  readonly sizes = new Map<string, { rows: number; cols: number }>()

  /** URL 이 pty 표면인가 */
  matches(url: string): boolean {
    return url.startsWith('/api/pty')
  }

  handle(request: IncomingMessage, url: string, body: unknown, response: ServerResponse): void {
    const parsed = new URL(url, 'http://fake')
    const directory = parsed.searchParams.get('location[directory]') ?? ''
    const id = /^\/api\/pty\/([^/?]+)/.exec(parsed.pathname)?.[1]
    const method = request.method ?? 'GET'

    if (id === undefined) {
      if (method === 'POST') return send(response, 200, directory, this.create(directory, body))
      return send(response, 200, directory, this.list(directory))
    }

    // **디렉토리가 다르면 없는 것이다** (실측: 404). 목록 격리만 있고 이쪽이 없으면
    // id 를 아는 것만으로 남의 셸을 조작할 수 있다.
    const found = this.list(directory).find((pty) => pty.id === id)
    if (found === undefined) return send(response, 404, directory, { _tag: 'PtyNotFoundError' })

    if (method === 'DELETE') {
      this.byDirectory.set(directory, this.list(directory).filter((pty) => pty.id !== id))
      response.writeHead(204).end()
      return
    }
    if (method === 'PUT') {
      const size = (body as { size?: { rows: number; cols: number } } | undefined)?.size
      if (size) this.sizes.set(id, size)
      return send(response, 200, directory, found)
    }
    send(response, 200, directory, found)
  }

  private list(directory: string): FakePty[] {
    return this.byDirectory.get(directory) ?? []
  }

  private create(directory: string, body: unknown): FakePty {
    const input = (body ?? {}) as { title?: string; args?: string[] }
    counter += 1
    const pty: FakePty = {
      id: `pty_fake${counter}`,
      title: input.title ?? `Terminal ${counter}`,
      // 실물은 로그인 셸 인자를 **스스로** 붙인다. 클라이언트가 `args` 를 보내면 두 벌이 된다 —
      // 그 실수가 여기서도 보이게 받은 것을 뒤에 잇는다.
      command: '/bin/zsh',
      args: ['-l', ...(input.args ?? [])],
      cwd: directory,
      status: 'running',
      pid: 1000 + counter,
    }
    this.byDirectory.set(directory, [...this.list(directory), pty])
    return pty
  }
}

function send(response: ServerResponse, status: number, directory: string, data: unknown): void {
  const text = JSON.stringify(status === 404 ? data : { location: { directory }, data })
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(text)
}
