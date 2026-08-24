import { OUR_MCP_SERVER } from '../../shared/protocol/mcpConfig'

// 원격 MCP 서버에 **도구 목록을 직접 물어본다.**
//
// opencode 를 거치지 않는 유일한 바깥 호출이다. 거칠 수가 없어서다: `GET /mcp` 는 상태만
// 주고, `/doc` 을 전수로 훑어도 서버별 도구 목록 표면이 없다 (`/mcp`, `/mcp/{name}/auth*`,
// `/mcp/{name}/connect|disconnect` 가 전부다 — 2026-08-24 실측). 그래서 커넥터 화면에서
// 사내 원격 서버는 「연결됨」인데 도구 칸이 빈 채로 남아 있었다.
//
// 대신 opencode 가 아는 것과 같은 주소로 우리가 MCP streamable HTTP 를 직접 말한다.
// 이 파일이 아는 것은 **읽기 한 가지(tools/list)** 뿐이다 — 도구를 부르지도, 세션을
// 이어 가지도 않는다. 화면 한 칸을 채우려는 것이고 그 이상은 opencode 의 일이다.
//
// **실측 (davis-cloud-mcp, 2026-08-24):**
//   POST initialize   → 200 `text/event-stream`, 응답 **헤더** `mcp-session-id` 에 세션
//   POST notifications/initialized → 202, 몸통 없음
//   POST tools/list   → 200 `text/event-stream`, `data:` 줄에 결과 (도구 6개)
//
// 함정 셋, 전부 직접 밟아 확인했다:
//   1. `Accept` 에 `application/json` 과 `text/event-stream` 이 **둘 다** 없으면 406 이다
//      ("Client must accept both …"). 하나만 보내면 시작도 못 한다.
//   2. 세션 id 를 안 실으면 400 (`Missing session ID`). 헤더에서 주고 헤더로 받는다.
//   3. **성공은 SSE 로 오고 오류는 그냥 JSON 으로 온다.** 위 400·406 응답이 그랬다.
//      `data:` 줄만 찾는 파서는 오류 응답에서 아무것도 못 읽고 조용히 빈손이 된다.
//
// `notifications/initialized` 는 이 서버에선 **없어도 tools/list 가 돌았다**(실측).
// 그래도 보낸다 — MCP 규약이 초기화 뒤에 보내라고 정한 것이고, 다른 서버가 그걸 요구해도
// 우리는 이유를 못 보는 자리(빈 목록)에서 실패하게 된다. 왕복 한 번이 그보다 싸다.

/** 도구 하나. 화면이 그리는 만큼만 뽑는다 (`shared/protocol/mcpConfig.ts` 의 `McpTool`). */
export interface RemoteTool {
  name: string
  description?: string
}

/** opencode 가 원격 MCP 에 쓰는 것과 같은 버전. 서버가 다른 것을 답해도 그대로 진행한다. */
const PROTOCOL_VERSION = '2025-03-26'

/** 둘 다 없으면 406 이다 (위 함정 1). */
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
}

/**
 * 원격 서버의 도구 목록. **못 물어봤으면 빈 배열이다 — 던지지 않는다.**
 *
 * 이 호출은 커넥터 다이얼로그가 열리는 길목에 있다. 서버가 죽었거나 느리다고 화면이
 * 막히면 안 되고(그 파일의 기존 원칙), 도구 칸이 비는 것은 이미 화면이 아는 모양이다.
 *
 * 시간 상한은 **세 왕복 전체**에 걸린다. 호출마다 걸면 상한이 사실상 3배가 된다.
 */
export async function remoteMcpTools(url: string, timeoutMs = 2500): Promise<RemoteTool[]> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const session = await initialize(url, abort.signal)
    // 세션이 없으면 다음 호출이 400 이다. 알면서 두 번 더 두드리지 않는다
    if (session === null) return []
    await post(url, session, abort.signal, { jsonrpc: '2.0', method: 'notifications/initialized' })
    const listed = await post(url, session, abort.signal, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
    return toTools(parseRpc(await listed.text()))
  } catch {
    // 죽은 서버·시간 초과·엉뚱한 응답 — 화면에서는 전부 「모른다」로 같다
    return []
  } finally {
    clearTimeout(timer)
  }
}

/** 세션 id 는 몸통이 아니라 **응답 헤더**로 온다 (실측). 없으면 이어 갈 수 없다. */
async function initialize(url: string, signal: AbortSignal): Promise<string | null> {
  const res = await post(url, null, signal, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      // 상대 서버 로그에 누가 물었는지 남는다. 우리 서버 이름과 같은 이름을 쓴다
      clientInfo: { name: OUR_MCP_SERVER, version: '1' },
    },
  })
  const session = res.headers.get('mcp-session-id')
  // 몸통을 읽어 연결을 돌려준다 — 여기 실린 서버 능력은 우리가 쓰지 않는다
  await res.text()
  return session !== null && session !== '' ? session : null
}

async function post(
  url: string,
  session: string | null,
  signal: AbortSignal,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: session === null ? HEADERS : { ...HEADERS, 'mcp-session-id': session },
    body: JSON.stringify(body),
    signal,
  })
}

/**
 * 응답 한 장에서 JSON-RPC 메시지를 꺼낸다.
 *
 * **두 모양이 다 온다** (위 함정 3): 성공은 `event: message` + `data: {…}` 의 SSE 이고,
 * 오류는 몸통 전체가 JSON 이다. 줄바꿈이 `\r\n` 이라 `data:` 뒤가 `\r` 로 끝나는데,
 * `JSON.parse` 는 앞뒤 공백을 견디므로 따로 다듬지 않는다.
 */
function parseRpc(text: string): Record<string, unknown> | null {
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const message = asRecord(line.slice('data:'.length))
    if (message !== null) return message
  }
  return asRecord(text)
}

/**
 * `result.tools` 에서 이름과 설명만 뽑는다.
 *
 * **`inputSchema` 는 안 싣는다.** 지금 화면이 인자를 그릴 자리가 없고, 이 서버들의 스키마는
 * 설명보다 훨씬 크다 — 안 쓰는 값을 봉투에 태우면 payload 만 부푼다 (`mcpConfig.ts` 의
 * 같은 판단). 모양을 못 믿어 거르는 일은 화면 쪽 `toTools` 가 한다: 여기서는 이름 없는
 * 항목만 떨군다 — 가리킬 대상이 없어 뽑을 것 자체가 없기 때문이다.
 */
function toTools(message: Record<string, unknown> | null): RemoteTool[] {
  const result = message === null ? null : asObject(message['result'])
  const tools = result === null ? null : result['tools']
  if (!Array.isArray(tools)) return []
  return tools.flatMap((item) => {
    const tool = asObject(item)
    if (tool === null) return []
    const name = tool['name']
    if (typeof name !== 'string' || name === '') return []
    const description = tool['description']
    return [{ name, ...(typeof description === 'string' ? { description } : {}) }]
  })
}

function asRecord(text: string): Record<string, unknown> | null {
  try {
    return asObject(JSON.parse(text))
  } catch {
    return null
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}
