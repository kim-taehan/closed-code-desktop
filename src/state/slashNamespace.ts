// `/` 2단계 네임스페이스 (DC-980, vscode slashCommands.ts 미러).
//
// 예전에는 명령과 스킬이 한 목록에 섞여 쏟아졌다. 항목이 늘수록 못 찾는다.
// 이제 **카테고리 → 항목** 두 단계로 좁힌다.
//
//   `/`                 → 카테고리 (command · skill)
//   `/command `         → 그 카테고리의 항목 (clear · compact · open · rename …)
//   `/command clear `   → 항목까지 정해짐 → 팝업을 닫고 입력을 넘긴다
//
// 표시할 때는 접두사를 감추고(`clear`), 제출할 때 canonical(`/clear`)로 되돌린다 —
// 사용자가 보는 것과 런타임이 받는 것이 달라도 되게 하려는 것이 이 분리의 목적이다.
//
// MCP 3단계(`/mcp {서버} {도구}`)는 서버·도구 목록이 런타임에서 와야 해서 아직 없다.
// 카테고리 목록에 항목만 더하면 되도록 자료구조는 열어 두었다.

export type SlashType = 'command' | 'skill'

export interface SlashCategory {
  /** `/` 뒤에 치는 이름. `/command` 면 'command'. */
  namespace: string
  type: SlashType
  description: string
}

/** 카테고리 목록. 순서가 곧 표시 순서다. */
export const SLASH_CATEGORIES: readonly SlashCategory[] = [
  { namespace: 'command', type: 'command', description: '커맨드 실행' },
  { namespace: 'skill', type: 'skill', description: '스킬 실행' },
]

export type SlashParsed =
  /** `/` · `/co` — 카테고리를 고르는 중 */
  | { kind: 'category'; query: string }
  /** `/command cl` — 그 카테고리 안에서 항목을 고르는 중 */
  | { kind: 'item'; namespace: string; type: SlashType; query: string }
  /** `/command clear ` — 항목까지 정해짐. 팝업은 닫고 입력을 그대로 둔다 */
  | { kind: 'prompt'; namespace: string; type: SlashType }

/**
 * 입력창 텍스트를 어느 단계인지로 읽는다. `/` 로 시작하지 않거나
 * 모르는 카테고리면 null — 팝업을 띄우지 않는다.
 */
export function parseSlashInput(text: string): SlashParsed | null {
  const match = text.match(/^\/(\S*)(?:(\s)([\s\S]*))?$/)
  if (!match) return null

  const head = match[1] ?? ''
  const separated = match[2] !== undefined
  const rest = match[3] ?? ''

  // 아직 공백이 없다 — 카테고리를 치는 중이다
  if (!separated) return { kind: 'category', query: head }

  const category = SLASH_CATEGORIES.find((c) => c.namespace === head)
  // 모르는 접두사 뒤의 공백은 그냥 평범한 글이다 (`/안녕 하세요`)
  if (!category) return null

  // 항목 뒤에 또 공백이 있으면 항목까지 고른 것 — 이제부터는 사용자가 인자를 친다
  if (/^\S+\s/.test(rest)) {
    return { kind: 'prompt', namespace: category.namespace, type: category.type }
  }

  return { kind: 'item', namespace: category.namespace, type: category.type, query: rest }
}

/**
 * 매칭 정규화. 대소문자·`_`·`-`·연속 공백을 한 가지로 접는다.
 *
 * canonical 이름은 따로 원본을 들고 다니므로 여기서 하이픈을 접어도 재조립에 지장이 없다.
 * **표시명과 매칭키가 어긋나지 않도록 규칙은 이 함수 한 곳에만 둔다.**
 */
export function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 카테고리 단계 필터. 빈 쿼리는 전부 통과. */
export function filterCategories(query: string): SlashCategory[] {
  const q = normalize(query)
  if (q === '') return [...SLASH_CATEGORIES]
  return SLASH_CATEGORIES.filter(
    (c) => normalize(c.namespace).includes(q) || normalize(c.description).includes(q),
  )
}

export interface SlashItem {
  /** 팝업에 보일 이름. 접두사를 뺀 것. */
  display: string
  description: string
}

/** 항목 단계 필터. 빈 쿼리는 전부 통과. */
export function filterItems<T extends SlashItem>(items: readonly T[], query: string): T[] {
  const q = normalize(query)
  if (q === '') return [...items]
  return items.filter(
    (item) => normalize(item.display).includes(q) || normalize(item.description).includes(q),
  )
}

/** 항목을 골랐을 때 입력창에 넣을 텍스트. 뒤 공백까지 넣어 바로 인자를 칠 수 있게 한다. */
export function itemInsertText(namespace: string, display: string): string {
  return `/${namespace} ${display} `
}

/** 카테고리를 골랐을 때 입력창에 넣을 텍스트. */
export function categoryInsertText(namespace: string): string {
  return `/${namespace} `
}

export interface SlashSubmission {
  type: SlashType
  /** 접두사를 뺀 항목 이름 — 빌트인 명령명이거나 스킬명이다. */
  name: string
  /** 항목 뒤에 이어 친 것. */
  args: string
}

/**
 * 전송 직전 텍스트를 실행 대상으로 되돌린다 (canonical 재조립).
 *
 * 2단계 형식(`/command clear 인자`)과 **예전 한 단계 형식(`/clear 인자`)을 모두 받는다** —
 * 사용자가 손에 익은 대로 쳐도 되게 하려는 것이고, 기존 대화 이력도 그대로 동작해야 한다.
 * 어느 쪽도 아니면 null (평범한 글이므로 그대로 런타임에 보낸다).
 */
export function parseSlashSubmission(text: string): SlashSubmission | null {
  const trimmed = text.trim()

  const namespaced = trimmed.match(/^\/(\S+)\s+(\S+)(?:\s+([\s\S]*))?$/)
  if (namespaced) {
    const category = SLASH_CATEGORIES.find((c) => c.namespace === namespaced[1])
    if (category) {
      return { type: category.type, name: namespaced[2]!, args: (namespaced[3] ?? '').trim() }
    }
  }

  // 예전 형식 — 카테고리 없이 바로 이름. 어느 종류인지는 호출부가 이름으로 판별한다.
  const legacy = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
  if (!legacy) return null
  // `/command` 처럼 카테고리만 친 것은 실행 대상이 아니다
  if (SLASH_CATEGORIES.some((c) => c.namespace === legacy[1])) return null
  return { type: 'command', name: legacy[1]!, args: (legacy[2] ?? '').trim() }
}
