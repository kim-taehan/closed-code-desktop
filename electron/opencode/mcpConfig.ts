import { Action, Kind } from '../../shared/protocol/kinds'
import { SERVER_NAME, TOOLS } from '../mcp/rpc'
import type { McpStatusEntry, OpencodeClient } from './client'

// 커넥터(MCP) 다이얼로그의 번역 — davis `mcp_config` 봉투 ↔ opencode `/mcp`.
//
// 위층(`session/mcpConfig.ts`)은 davis 시절 그대로 `kind=mcp_config` 로 묻는다. 그 물음에
// 어댑터가 답하지 않아 다이얼로그가 영영 비어 있었다 — 고친 것은 여기 한 곳이고
// `session/*` 은 손대지 않았다 (부패방지 계층).
//
// **payload 의 뜻이 통째로 바뀌었다.** davis 는 개인 자격을 실어 날랐고 opencode 에는 그
// 개념이 없다 — 지금 실리는 것은 연결 상태다. 어느 필드가 왜 사라졌는지는
// `shared/protocol/mcpConfig.ts` 머리말이 정본이다.
//
// **한 화면을 두 표면에서 만든다** (실측 1.18.18):
//   GET /mcp?directory=      → {"<이름>":{"status":"failed","error":"SSE error: …"}}  상태만
//   GET /config?directory=   → .mcp["<이름>"] = {type:"remote", url:"…"}              주소·갈래
// `GET /mcp` 는 주소도 local/remote 도 주지 않는다. 시안이 요구한 "remote · http://…" 는
// 두 번째 호출에서만 나온다.
//
// ⚠️ **두 표면의 목록이 같지 않다. 양쪽 모두 한쪽에만 있는 이름이 있다.**
//
// (a) 상태에만 있다 — 런타임 등록(`POST /mcp`). **우리 자신이 그렇다.** `GET /mcp` 에는
//     뜨는데 `GET /config` 에는 없다 (실측 1.18.18 — 등록이 파일에 안 써지는 것과 같은 사유,
//     `mcp/register.ts` 머리말). 그래서 우리 서버는 transport 도 url 도 모르고, 아는 것은
//     **도구 목록**뿐이다. 화면은 `tools` 가 찬 항목을 "이 앱이 띄움" 으로 읽는다.
//     기준을 설정 쪽으로 잡으면 우리가 목록에서 빠지므로 **상태 맵이 기준이다.**
//
// (b) 설정에만 있다 — opencode 가 그 항목을 **버린 것이다.** 스키마를 어긴 설정이 트리거고,
//     증상이 고약하다 (2026-08-15 desktop-dev 실측, opencode 1.18.18):
//
//       opencode.json:  "badremote": {"type":"remote","enabled":true}      ← url 이 없다
//       GET /config .mcp:  badremote = {"enabled":true}                    ← type 까지 사라진 껍데기
//       GET /mcp        :  badremote 없음                                   ← 아예 안 나타난다
//
//     검증에 걸린 필드가 통째로 떨어져 나가고, 그 다음 로더가 "type 이 없다" 며 건너뛴다.
//     **사용자는 오타를 냈는데 커넥터 화면에 아무 흔적이 없다** — 조용히 죽는 부류다.
//     그래서 합집합을 돌아 이런 이름도 `status:'unknown'` 으로 목록에 남긴다 (`readState`).
//     이 트리거를 찾아 준 것은 contract-qa 이고, 위 재현은 내가 따로 쟀다.
//
// **불린을 믿지 않는다.** connect 는 실패해도 `true` 를 준다 (`client.setMcpEnabled` 주석).
// 그래서 켜고 끈 뒤에는 항상 상태를 다시 읽어 그 결과로 봉투를 만든다. 낙관적으로 고치면
// 죽은 서버가 「연결됨」으로 보인다 — davis 시절 "저장 뒤에는 응답으로 상태가 갱신된다"는
// 규칙(`session/mcpConfig.ts`)이 여기서도 그대로 맞는 이유다.

type McpClient = Pick<OpencodeClient, 'mcpStatus' | 'config' | 'setMcpEnabled'>

/**
 * `mcp_config` 봉투 하나를 처리하고 위층에 돌려줄 봉투를 만든다.
 *
 * 어떤 action 이든 **끝은 상태 한 장**이다 — 화면이 상태만 그리기 때문이고,
 * 켜고 끄기가 성공했는지도 그 상태로만 알 수 있다.
 *
 * `mcp_config_test` 는 답을 만들지 않는다. davis 의 "저장하지 않고 이 자격으로 붙어만 본다"
 * 인데 opencode 에는 대응 표면이 없다 (붙는 것은 곧 설정을 켜는 것이다). 화면도 부르지 않는다.
 */
export async function mcpConfigFrame(
  client: McpClient,
  directory: string | null,
  action: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (action === Action.MCP_CONFIG_TEST) return null
  if (action === Action.MCP_CONFIG_SET) await applyEnabled(client, directory, data)
  return { kind: Kind.MCP_CONFIG, action: Action.MCP_CONFIG_STATUS, data: await readState(client, directory) }
}

/**
 * `mcp_config_set` → connect/disconnect.
 *
 * davis 는 `{server_name, enabled, credentials}` 였고 자격이 본체였다. opencode 로 오면서
 * 남는 것은 `enabled` 뿐이라 **켜고 끄기**로 읽는다 — 그 한 낱말이 마침 opencode 의
 * connect/disconnect 와 같은 뜻이라 새 action 을 만들지 않았다.
 *
 * **실패해도 던지지 않는다.** 사유는 다음 줄에서 다시 읽는 상태에 `error` 로 실려 오고,
 * 여기서 예외를 올리면 화면 전체가 실패로 덮인다 — 서버 하나가 안 붙은 것뿐인데.
 */
async function applyEnabled(
  client: McpClient,
  directory: string | null,
  data: Record<string, unknown>,
): Promise<void> {
  const name = data['server_name']
  if (typeof name !== 'string' || name === '') return
  try {
    await client.setMcpEnabled(directory, name, data['enabled'] !== false)
  } catch {
    // 삼킨다 (위 주석)
  }
}

/**
 * 두 표면을 합쳐 davis payload 로 만든다.
 *
 * **설정 조회가 실패해도 목록은 낸다** — 주소와 local/remote 를 못 그릴 뿐이고,
 * 상태(연결됨·실패·꺼짐)는 그것만으로도 쓸모가 있다.
 *
 * 순서는 opencode 가 준 그대로다. 이름으로 정렬하지 않는다 — 설정 파일에 적힌 순서가
 * 사용자가 아는 순서다.
 *
 * **두 키 집합의 합집합을 돈다.** 기준은 상태 맵이고(우리 서버가 설정에 없다), 거기에
 * 설정에만 있는 이름을 뒤에 붙인다. 양쪽 다 한쪽에만 있는 경우가 실재하기 때문이다:
 *
 *   상태에만 있다 — 런타임 등록(`POST /mcp`). 우리 자신이 그렇다
 *   설정에만 있다 — opencode 가 그 항목을 **버렸다** (아래)
 *
 * 설정에만 있는 쪽은 `status:'unknown'` 으로 낸다 — opencode 가 상태를 말해 주지 않았다는
 * 것이 사실 그대로다. 지어낼 수 있는 다른 값이 없다.
 */
async function readState(client: McpClient, directory: string | null): Promise<Record<string, unknown>> {
  let status: Record<string, McpStatusEntry>
  try {
    status = await client.mcpStatus(directory)
  } catch (error) {
    return { servers: [], message: error instanceof Error ? error.message : String(error) }
  }
  const configured = await mcpSettings(client, directory)
  const listed = Object.entries(status).map(([name, entry]) => toServer(name, entry, configured[name]))
  const orphans = Object.keys(configured)
    .filter((name) => !(name in status))
    .map((name) => toServer(name, {}, configured[name]))
  return { servers: [...listed, ...orphans], message: '' }
}

async function mcpSettings(
  client: McpClient,
  directory: string | null,
): Promise<Record<string, { type?: string; url?: string; command?: unknown }>> {
  try {
    return (await client.config(directory)).mcp ?? {}
  } catch {
    return {}
  }
}

/**
 * payload 는 snake_case 다 — 이 도메인에 camelCase 별칭이 없다는 davis 규칙 그대로.
 *
 * ⚠️ **`enabled` 를 일부러 안 싣는다. 「꺼짐」의 근거는 런타임 `status` 하나다.**
 *
 * 설정의 `enabled` 와 `GET /mcp` 의 status 는 **갈라지고, 갈라진 채로 남는다** (contract-qa
 * 실측): `enabled:false` 인 서버에 connect 하면 상태가 `disabled` → `failed` 로 넘어가는데
 * 파일의 `enabled` 는 `false` 그대로다. disconnect 를 부르기 전까지 그 상태로 남는다.
 *
 * 그래서 둘을 한 카드에 얹으면 「꺼짐 + 실패」라는 모순이 나온다. 런타임 쪽을 정본으로 삼는다 —
 * **화면이 그려야 하는 것은 지금 실제 상태지 파일에 뭐라 적혀 있는지가 아니고**, 사용자가
 * 카드에서 끄면 disconnect 가 나가 `disabled` 로 되돌아오므로 고리도 닫힌다.
 *
 * 되살리고 싶어지거든(설정에 꺼져 있는데 왜 실패로 보이나 싶을 때) 그때 진실의 출처가 둘이
 * 된다는 것을 먼저 보라. `mcpConfig.test.ts` 의 `divergent` 항목이 이 자리를 잠근다.
 */
function toServer(
  name: string,
  entry: McpStatusEntry,
  setting: { type?: string; url?: string; command?: unknown } | undefined,
): Record<string, unknown> {
  const where = locationOf(setting)
  return {
    server_name: name,
    status: typeof entry?.status === 'string' ? entry.status : 'unknown',
    transport: setting?.type === 'local' || setting?.type === 'remote' ? setting.type : 'unknown',
    // 우리가 띄운 서버의 도구만 안다 — opencode 는 도구 목록을 안 준다 (`mcp/rpc.ts` 가 정본)
    tools: name === SERVER_NAME ? TOOLS.map((tool) => tool.name) : [],
    ...(where !== '' ? { url: where } : {}),
    ...(typeof entry?.error === 'string' && entry.error !== '' ? { error: entry.error } : {}),
  }
}

/** remote 는 주소, local 은 실행 명령. 사용자가 "어느 서버인지" 를 가리는 근거가 이 한 줄이다. */
function locationOf(setting: { url?: string; command?: unknown } | undefined): string {
  if (typeof setting?.url === 'string' && setting.url !== '') return setting.url
  if (Array.isArray(setting?.command)) {
    return setting.command.filter((part): part is string => typeof part === 'string').join(' ')
  }
  return ''
}
