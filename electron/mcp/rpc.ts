// MCP 요청 하나를 응답 하나로 바꾸는 자리.
//
// ⚠️ **`electron/session/mcpConfig.ts` 와 다른 것이다.** 저쪽은 앱이 MCP **클라이언트**로서
// 개인 자격증명을 다루는 화면(`McpDialog`)의 뒷단이고, 여기(`electron/mcp/`)는 앱이 MCP
// **서버**가 되어 에이전트가 앱을 조작하게 여는 문이다. 같은 낱말이 두 뜻으로 쓰인다.
//
// **HTTP 를 모른다.** 소켓·헤더·토큰은 옆의 server.ts 가 보고, 여기는 JSON-RPC 객체만
// 다룬다. 프로토콜은 손으로 쓴다 — 메서드 몇 개에 도구 둘이라 SDK 를 들일 만큼이 아니다.
//
// `develop-desktop/electron/mcp/rpc.ts` 를 옮겨 왔다. 바뀐 것은 서버 이름과 도구 설명뿐이고
// 프로토콜 처리는 그대로다 — 상대가 claude 든 opencode 든 같은 JSON-RPC 다.

/** 우리가 말하는 프로토콜. 클라이언트가 다른 버전을 부르면 그쪽 것을 되돌려 준다. */
const PROTOCOL_VERSION = '2025-06-18'

/**
 * opencode 가 이 서버를 부르는 이름.
 *
 * 도구 이름은 opencode 가 `sanitize(서버이름) + "_" + sanitize(도구이름)` 으로 짓고
 * `sanitize` 는 `s.replace(/[^a-zA-Z0-9_-]/g, "_")` 다 (1.17.18 바이너리 실측).
 * **하이픈은 남는다** — 그래서 모델이 보는 이름은 `closed-code-desktop_open_file` 이다.
 *
 * ⚠️ **이 상수를 바꾸면 등록 이름이 바뀐다.** desktop 은 사용자 `opencode.json` 을 건드리지
 * 않고 세션마다 런타임으로 등록하므로(`register.ts:16`) 옛 이름은 opencode 가 다시 뜨면
 * 사라진다. 다만 **바꾼 뒤 첫 실행에서 살아 있던 opencode 에는 두 이름이 함께 보일 수 있다.**
 */
export const SERVER_NAME = 'closed-code-desktop'

export interface RpcRequest {
  id?: unknown
  method?: unknown
  params?: unknown
}

export interface RpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

/** 도구를 실제로 돌리는 쪽. 실패는 던져서 알린다 — 그 말이 그대로 모델에게 간다. */
export type RunTool = (name: string, args: Record<string, unknown>) => Promise<string>

export const TOOLS = [
  {
    name: 'open_file',
    description:
      '이 프로젝트의 파일을 Open Code Desktop 화면에 연다. 사용자가 파일을 눈으로 보고 싶어 할 때 쓴다. 사용자가 다른 프로젝트를 보고 있으면 열지 못하며, 그 사실을 결과로 알려준다.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '프로젝트 루트 기준 상대경로. 절대경로도 받지만 루트 밖이면 거부한다.',
        },
        line: {
          type: 'number',
          description: '열면서 옮겨 갈 줄 번호 (1부터). 없으면 파일 첫머리를 연다.',
        },
      },
      required: ['path'],
    },
  },
] as const

/**
 * 슬래시 커맨드로 나가는 것들.
 *
 * ⚠️ **opencode 는 등록 직후 `prompts/list` 를 부르지 않는다** (1.17.18 실측 — 붙을 때
 * 오는 것은 `initialize` → `notifications/initialized` → `tools/list` 뿐이다).
 * 그래도 남겨 두는 이유는 이 표면이 MCP 표준이고 비용이 이 목록 하나이기 때문이다.
 * 부르지 않는 클라이언트에게는 없는 것과 같다.
 *
 * prompt 는 도구를 대신하지 않는다 — 사람이 직접 칠 때의 지름길일 뿐이고,
 * 실제로 여는 일은 아래 문구를 읽은 모델이 open_file 을 불러서 한다.
 */
export const PROMPTS = [
  {
    name: 'open',
    description: '파일을 Open Code Desktop 화면에 연다',
    arguments: [
      { name: 'path', description: '프로젝트 루트 기준 상대경로', required: true },
      { name: 'line', description: '옮겨 갈 줄 번호 (1부터)', required: false },
    ],
  },
] as const

/**
 * 요청 하나를 처리한다. 알림(id 가 없는 것)이면 돌려줄 것이 없어 null 을 준다.
 */
export async function handleRpc(
  request: RpcRequest,
  runTool: RunTool,
): Promise<RpcResponse | null> {
  const id = idOf(request.id)
  const method = typeof request.method === 'string' ? request.method : ''

  // 알림에는 응답하지 않는다 — 응답을 보내면 짝이 없는 id 로 클라이언트가 헷갈린다
  if (id === undefined) return null

  switch (method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: initializeResult(request.params) }

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } }

    case 'tools/call':
      return { jsonrpc: '2.0', id, result: await callTool(request.params, runTool) }

    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts: PROMPTS } }

    case 'prompts/get':
      return { jsonrpc: '2.0', id, result: promptResult(request.params) }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `모르는 메서드입니다: ${method}` },
      }
  }
}

function initializeResult(params: unknown): unknown {
  const asked = paramsOf(params)['protocolVersion']
  return {
    // 상대가 부른 버전을 그대로 돌려준다 — 우리가 쓰는 것은 도구 목록·호출뿐이라
    // 버전 사이에 다를 것이 없다. 우리 버전을 고집하면 새 클라이언트가 거절한다.
    // 실측: opencode 1.17.18 은 `2025-11-25` 를 부른다 — 우리 상수보다 새 버전이다.
    protocolVersion: typeof asked === 'string' ? asked : PROTOCOL_VERSION,
    capabilities: { tools: {}, prompts: {} },
    serverInfo: { name: SERVER_NAME, version: '1' },
  }
}

/**
 * 도구를 부른다.
 *
 * **실패해도 JSON-RPC 오류로 만들지 않는다.** 프로토콜 오류로 올리면 모델에게는
 * "도구가 고장났다" 로만 보이고 무엇이 잘못됐는지 안 간다. isError 로 내려보내야
 * 모델이 경로를 고쳐 다시 부른다.
 */
async function callTool(params: unknown, runTool: RunTool): Promise<unknown> {
  const source = paramsOf(params)
  const name = source['name']
  if (typeof name !== 'string') {
    return errorResult('도구 이름이 없습니다')
  }

  const args = source['arguments']
  const parsed = args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {}

  try {
    return { content: [{ type: 'text', text: await runTool(name, parsed) }] }
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error))
  }
}

/**
 * 슬래시 커맨드가 대화에 넣을 말.
 *
 * 여기서 도구를 부르지 않는다 — prompt 는 사용자 메시지를 만들어 줄 뿐이고, 그것을
 * 읽은 모델이 open_file 을 부른다. 그래야 `/open src/a.ts 12` 처럼 인자가 빠지거나
 * 어긋나도 모델이 되물어 고칠 수 있다.
 */
function promptResult(params: unknown): unknown {
  const source = paramsOf(params)
  const args = paramsOf(source['arguments'])
  const path = typeof args['path'] === 'string' ? args['path'] : ''
  const line = args['line']
  const at = typeof line === 'string' || typeof line === 'number' ? ` ${line}번째 줄로` : ''

  return {
    description: '파일을 Open Code Desktop 화면에 연다',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            path === ''
              ? '어떤 파일을 열지 물어본 뒤 open_file 도구로 열어라.'
              : `open_file 도구로 ${path} 을(를)${at} 열어라. 파일 내용을 읽거나 설명하지는 마라 — 화면에 띄우기만 하면 된다.`,
        },
      },
    ],
  }
}

function errorResult(message: string): unknown {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function paramsOf(params: unknown): Record<string, unknown> {
  return params !== null && typeof params === 'object' ? (params as Record<string, unknown>) : {}
}

/** 응답을 붙일 id. 알림이면 undefined — null 은 "id 가 null 인 요청" 이라 다르다. */
function idOf(id: unknown): string | number | null | undefined {
  if (typeof id === 'string' || typeof id === 'number' || id === null) return id
  return undefined
}
