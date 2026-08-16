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
  {
    name: 'open_terminal',
    description:
      'Open Code Desktop 화면 아래 셸 칸을 펴고, 명령을 **채워만 둔다 — 실행하지 않는다.** 사용자가 화면에서 눈으로 확인하고 직접 엔터를 친다. 지우거나 되돌리기 어려운 명령, 사용자가 판단해야 하는 명령을 제안할 때 쓴다. 결과가 곧바로 필요하면 이 도구가 아니라 셸을 직접 실행하는 도구를 쓴다 — 여기서는 아무것도 돌아가지 않는다. 사용자가 다른 프로젝트를 보고 있으면 열지 못하며, 그 사실을 결과로 알려준다.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            '채울 명령 한 줄. 없으면 칸만 편다. **개행을 넣지 마라** — 셸에 들어가는 즉시 실행되어 사용자가 확인할 기회가 사라지므로 거절한다.',
        },
      },
      // command 는 없어도 된다 — "터미널 좀 열어 줘" 만으로도 뜻이 있다
      required: [],
    },
  },
  {
    name: 'run_project',
    description:
      '개발 서버·테스트 감시처럼 **안 끝나는 명령**을 Open Code Desktop 이 붙들고 돌린다. 셸 도구는 명령이 끝나야 출력이 나와서 이런 것을 못 돌린다 — 이 도구는 시작만 하고 곧바로 돌아오며, 출력은 read_logs 로 읽는다. 같은 이름이 이미 돌고 있으면 겹쳐 띄우지 않고 그 사실을 알려준다. **멈추거나 다시 띄우는 기능은 없다** — 사용자가 보고 있던 것을 없애는 일이라 사용자가 직접 탭을 닫아야 한다. 사용자가 다른 프로젝트를 보고 있으면 띄우지 못하며, 그 사실을 결과로 알려준다.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            '이 프로세스를 부를 짧은 이름 (dev · test · build 등). 화면의 탭 이름이 되고, read_logs 로 로그를 물을 때 이 이름을 쓴다. 사용자의 셸 칸 이름(shell…)은 쓸 수 없다.',
        },
        command: {
          type: 'string',
          description:
            '프로젝트 루트에서 돌릴 명령 한 줄 (예: `npm run dev`). **개행을 넣지 마라** — 여러 개를 이어 돌리려면 `&&` 로 한 줄에 쓴다.',
        },
      },
      required: ['name', 'command'],
    },
  },
  {
    name: 'read_logs',
    description:
      'run_project 로 띄워 **지금 돌고 있는** 프로세스가 그동안 뱉은 출력을 읽는다. 셸 도구가 명령을 새로 돌리는 것과 다르다 — 이쪽은 이미 돌고 있는 것을 들여다볼 뿐이라 아무것도 실행하지 않는다. 개발 서버가 떴는지, 방금 고친 파일이 다시 컴파일됐는지, 무슨 오류가 났는지를 볼 때 쓴다. **결과는 반드시 잘려서 오고 전체 줄 수가 함께 온다** — 잘렸으면 tail·level·since 로 좁혀 다시 부른다.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'run_project 로 띄울 때 준 이름.',
        },
        tail: {
          type: 'number',
          description: '마지막 몇 줄을 볼지. 기본 100줄, 최대 1000줄.',
        },
        level: {
          type: 'string',
          description:
            '`error` 면 오류로 보이는 줄만, `warn` 이면 경고까지, `all`(기본)이면 전부. 수천 줄에서 문제만 집을 때 쓴다. 낱말로 짐작하는 것이라 놓치는 줄이 있을 수 있다.',
        },
        since: {
          type: 'number',
          description:
            '여기부터 뒤만 본다. **지난번 답의 마지막 줄에 실린 값을 그대로 주면** 그 뒤에 새로 나온 것만 온다 — 고치고 다시 물을 때 같은 것을 두 번 읽지 않는 길이다.',
        },
      },
      required: ['name'],
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
