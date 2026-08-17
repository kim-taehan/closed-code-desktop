// `/` 목록 — **opencode 가 아는 것 전부**.
//
// davis 시절엔 스킬만 Admin 서버에서 받아 왔고, 빌트인 명령은 클라이언트에 박혀 있었다.
// opencode 는 CLI 도 이 목록 하나로 `/` 를 그린다 — 명령·MCP 프롬프트·스킬이 한 배열로
// 오고 종류는 `source` 로만 갈린다. 그래서 여기도 카테고리로 나누지 않고 그대로 올린다.
//
// ⚠️ **`/api/command` 가 아니라 레거시 `/command` 다.** 실측(1.17.18, 같은 디렉토리에서
// 동시 호출):
//
//   GET /api/command?location[directory]=…  →  {location, data:[init, review]}   ← 스킬이 없다
//   GET /command?directory=…                →  [init, review, …스킬 18개]        ← 전부 있다
//
// `/api` 판은 스킬을 빼놓는다. 목록을 다 보여주려면 이쪽뿐이라 여기만 레거시 표면을 쓴다
// (`client.ts` 의 `/mcp` 와 같은 사유 — `/api` 판이 같은 것을 주지 않는다).
// 레거시라 `{data:…}` 래핑도 없다: **배열이 그대로 온다.**
//
// ⚠️ **질의 이름은 평문 `directory=` 다** (`/mcp` 와 같고 pty 의 `location[directory]=` 와 다르다).
// 빼면 서버 cwd 로 떨어져 **다른 프로젝트의 목록이 온다** — 실측: 디렉토리마다 목록이 다르다.

import { describeError } from '../../shared/errors/describeError'

export interface CommandSummary {
  name: string
  description: string
  /** opencode 가 붙여 주는 출처. 화면은 이걸로 태그를 그린다. */
  source: 'command' | 'mcp' | 'skill'
  /** 실행할 프롬프트 원본. `$ARGUMENTS` 자리에 사용자가 친 인자가 들어간다. */
  template: string
  /** 이 명령이 지정한 에이전트·모델. 우리는 표시만 하고 세션에 걸지는 않는다. */
  agent?: string
  model?: string
  /** 별도 에이전트로 도는 명령 (opencode 의 subtask) */
  subtask?: boolean
}

export interface CommandListResult {
  commands: CommandSummary[]
  /** 목록을 못 받은 이유. 받았으면 없다. */
  error?: string
}

const TIMEOUT_MS = 10_000

interface CommandInfo {
  name?: unknown
  description?: unknown
  source?: unknown
  template?: unknown
  agent?: unknown
  model?: unknown
  subtask?: unknown
}

/**
 * 이 디렉토리에서 쓸 수 있는 명령·스킬 전부.
 *
 * **실패해도 빈 목록으로 돌려준다** — 목록 없이도 대화는 되므로 화면이 막히면 안 된다.
 * 사유는 error 로 함께 올려 보낸다.
 */
export async function fetchCommands(
  opencodeUrl: string,
  directory: string,
): Promise<CommandListResult> {
  const base = opencodeUrl.trim().replace(/\/+$/, '')
  if (base === '') return { commands: [], error: 'opencode 서버 주소가 없습니다' }
  if (directory.trim() === '') return { commands: [], error: '열린 프로젝트가 없습니다' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const url = `${base}/command?directory=${encodeURIComponent(directory)}`
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return { commands: [], error: `명령 목록 조회 실패 (HTTP ${response.status})` }

    const body = (await response.json()) as unknown
    const items = Array.isArray(body) ? (body as CommandInfo[]) : []
    return { commands: items.filter(hasName).map(toSummary) }
  } catch (error) {
    if (controller.signal.aborted) return { commands: [], error: '명령 목록 조회 시간 초과' }
    return { commands: [], error: describeError(error) }
  } finally {
    clearTimeout(timer)
  }
}

function hasName(item: CommandInfo): boolean {
  return typeof item?.name === 'string' && item.name !== ''
}

function toSummary(item: CommandInfo): CommandSummary {
  const source = item.source
  return {
    name: item.name as string,
    description: typeof item.description === 'string' ? item.description : '',
    // 스키마상 필수가 아닌 값이라 모르는 것은 명령으로 둔다 — 태그만 덜 정확해진다
    source: source === 'mcp' || source === 'skill' ? source : 'command',
    template: typeof item.template === 'string' ? item.template : '',
    ...(typeof item.agent === 'string' ? { agent: item.agent } : {}),
    ...(typeof item.model === 'string' ? { model: item.model } : {}),
    ...(item.subtask === true ? { subtask: true } : {}),
  }
}
