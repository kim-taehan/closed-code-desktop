import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { handleRpc, type RunTool } from './rpc'

// 에이전트가 이 앱을 조작할 수 있게 열어 두는 문.
//
// ⚠️ `electron/session/mcpConfig.ts`(앱이 MCP **클라이언트**인 쪽)와 다른 것이다 — `rpc.ts` 머리말.
//
// **경계 셋을 여기서 지킨다.** 127.0.0.1 에만 바인딩하고(다른 기계에서 못 닿는다),
// 실행마다 새 토큰을 요구하고(앱을 껐다 켜면 옛 토큰은 죽는다), 프로젝트 신원을
// URL 경로에서 읽는다. 신원이 요청 안에 없으면 A 탭의 에이전트가 B 탭을 여는 것을
// 막을 방법이 없다 — 탭이 여섯이면 요청만 보고는 누가 보냈는지 알 수 없다.
//
// **공여(develop-desktop)보다 노출면이 넓다.** 공여는 자기가 띄운 CLI 프로세스에게만
// 인자로 주소를 줬지만, 이 앱은 **사용자가 띄운 공용 opencode 서버**에 등록한다
// (`register.ts`). 같은 프로젝트 디렉토리로 그 서버에 붙은 다른 클라이언트도 우리 도구를
// 본다. 그래서 위 셋 중 어느 것도 느슨하게 하지 않는다.

/** 본문 상한. 도구 인자는 경로 한 줄이라 이보다 클 이유가 없다. */
const MAX_BODY_BYTES = 64 * 1024

const PATH_PREFIX = '/mcp/'

export interface McpAddress {
  port: number
  token: string
}

/** 프로젝트를 알고 도구를 돌리는 쪽. 실패는 던져서 알린다. */
export type RunProjectTool = (
  projectId: string,
  name: string,
  args: Record<string, unknown>,
) => Promise<string>

export class McpServer {
  #server: Server | null = null
  #address: McpAddress | null = null

  constructor(private readonly runTool: RunProjectTool) {}

  /** 이미 떠 있으면 그대로 둔다 — 설정을 두 번 켜도 포트가 둘이 되지 않는다. */
  async start(): Promise<void> {
    if (this.#server !== null) return

    const token = randomBytes(24).toString('hex')
    const server = createServer((request, response) => {
      void this.#handle(token, request, response)
    })
    // 포트를 못 잡아도 앱은 돌아야 한다 — MCP 는 있으면 좋은 것이지 앱의 조건이 아니다
    server.on('error', (error) => {
      console.warn(`MCP 서버 오류: ${error.message}`)
    })
    this.#server = server

    await new Promise<void>((done) => {
      server.listen(0, '127.0.0.1', done)
    })

    const listening = server.address()
    if (listening === null || typeof listening === 'string') {
      await this.stop()
      return
    }
    this.#address = { port: listening.port, token }
  }

  async stop(): Promise<void> {
    const server = this.#server
    this.#server = null
    this.#address = null
    if (server === null) return

    await new Promise<void>((done) => {
      server.close(() => done())
    })
  }

  /** 아직 안 떴으면 null. opencode 에 등록하는 쪽이 이걸 보고 URL 을 만든다. */
  address(): McpAddress | null {
    return this.#address
  }

  async #handle(token: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? ''

    if (request.method !== 'POST' || !url.startsWith(PATH_PREFIX)) {
      // 스트리밍(GET)·세션 종료(DELETE)는 안 쓴다. 405 로 "없다" 를 분명히 알린다.
      //
      // 실측(opencode 1.17.18): opencode 는 붙자마자 SSE 를 얻으려 우리 경로로 GET 을
      // 한 번 시도한다. 405 를 돌려줘도 연결은 `connected` 로 끝난다 — MCP 명세가
      // 허용하는 폴백이다. 여기서 200 을 주려고 스트림을 만들 필요가 없다.
      send(response, request.method === 'POST' ? 404 : 405, { error: 'not_found' })
      return
    }

    if (request.headers.authorization !== `Bearer ${token}`) {
      send(response, 401, { error: 'unauthorized' })
      return
    }

    const projectId = decodeURIComponent(url.slice(PATH_PREFIX.length).split('?')[0] ?? '')
    if (projectId === '') {
      send(response, 404, { error: 'not_found' })
      return
    }

    let body: string
    try {
      body = await readBody(request)
    } catch {
      send(response, 413, { error: 'too_large' })
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      send(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: '깨진 JSON' } })
      return
    }

    const answer = await handleRpc(parsed as Record<string, unknown>, this.#toolFor(projectId))
    // 알림에는 돌려줄 것이 없다 — 202 로 받았다는 것만 알린다
    if (answer === null) {
      response.writeHead(202).end()
      return
    }
    send(response, 200, answer)
  }

  #toolFor(projectId: string): RunTool {
    return (name, args) => this.runTool(projectId, name, args)
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  })
  response.end(text)
}

/** 상한을 넘으면 읽기를 끊는다 — 끝까지 받아 두고 재면 그 사이 메모리가 찬다. */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('too_large')
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}
