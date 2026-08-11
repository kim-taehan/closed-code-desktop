// 스킬 목록.
//
// **davis 시절엔 Admin 서버에서 왔다** — 라이선스 JWT 로 인증하고
// `GET {adminUrl}skills/?limit=500` 을 부른 뒤, 목록에 안 나오는 런타임 내장 스킬
// (`axgentic-guide`·`pptx`)을 코드에 박아 두고 합쳐 줬다.
//
// opencode 에는 중앙 서버가 없다. 스킬은 **opencode 가 로컬 파일로 관리**하고
// (`~/.config/opencode/skills/*`, 프로젝트 `.opencode/skills/*`) `GET /api/skill` 로
// 그대로 돌려준다. 그래서 여기는 물어보기만 한다 — 인증도, 내장 목록 하드코딩도 없다.
//
// 실측(opencode 1.17.18): 응답은 `{ location, data: SkillV2Info[] }` 이고
// `SkillV2Info` 는 `{ name, description?, slash?, location, content }` 다.
// `/api/*` 가 `{data:...}` 로 감싸는 규칙은 여기도 같다 (README 실측 함정 4).

export interface SkillSummary {
  name: string
  description: string
  /** inline 이면 대화 중에 바로 쓰이고, fork 면 별도 에이전트로 돈다 */
  context: string
  /** 슬래시 명령으로도 부를 수 있는 스킬 */
  builtin?: boolean
}

export interface SkillListResult {
  skills: SkillSummary[]
  /** 목록을 못 받은 이유. 받았으면 없다. */
  error?: string
}

const TIMEOUT_MS = 10_000

interface SkillV2Info {
  name: string
  description?: string
  slash?: boolean
}

/**
 * opencode 가 아는 스킬 전부.
 *
 * **실패해도 빈 목록으로 돌려준다** — 스킬 없이도 대화는 되므로, 목록 하나 때문에
 * 화면이 막히면 안 된다. 사유는 error 로 함께 올려 보낸다.
 */
export async function fetchSkills(opencodeUrl: string): Promise<SkillListResult> {
  const base = opencodeUrl.trim().replace(/\/+$/, '')
  if (base === '') return { skills: [], error: 'opencode 서버 주소가 없습니다' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${base}/api/skill`, { signal: controller.signal })
    if (!response.ok) return { skills: [], error: `스킬 목록 조회 실패 (HTTP ${response.status})` }

    const body = (await response.json()) as { data?: unknown }
    const items = Array.isArray(body.data) ? (body.data as SkillV2Info[]) : []
    return { skills: items.filter((item) => typeof item?.name === 'string').map(toSummary) }
  } catch (error) {
    if (controller.signal.aborted) return { skills: [], error: '스킬 목록 조회 시간 초과' }
    return { skills: [], error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

function toSummary(item: SkillV2Info): SkillSummary {
  return {
    name: item.name,
    description: item.description ?? '',
    // opencode 에는 inline/fork 구분이 없다 — 화면이 요구하는 필드라 inline 으로 채운다
    context: 'inline',
    ...(item.slash ? { builtin: true } : {}),
  }
}
