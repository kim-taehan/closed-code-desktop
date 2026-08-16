// 실행 목록의 **저장 형식** — 읽기와 쓰기가 한 모듈에 있다 (설계 §2).
//
// ## 어디에 두는가 — 프로젝트 파일이 아니라 앱 저장소
//
// 처음에는 `<프로젝트>/AGENTS.md` 의 「실행」 절에 마크다운 표로 적었다. 그 자리를 버렸다:
// **opencode 는 AGENTS.md 를 시스템 프롬프트로 싣는다**
// (`packages/opencode/src/session/instruction.ts` — 실측). 거기에 기계 판독용 표를 두면
// 셋이 걸린다. ① 쓰든 안 쓰든 **매 요청마다 컨텍스트를 먹는다** ② AGENTS.md 는
// "이렇게 일해라" 를 적는 자리라 우리 표가 **지시로 읽혀 진짜 지시를 희석한다**
// ③ 앱이 모델의 지시문을 자동으로 덮어쓰게 된다 — 그 자체가 위험하다.
// 모델은 `run_project` 도구로 목록을 알면 되지 프롬프트에 표를 이고 다닐 이유가 없다.
//
// ⚠️ **잃은 것을 적어 둔다 — 셋이다.** 목록이 앱 저장소로 들어가면
// **버전 관리가 안 되고 · 팀원과 공유되지 않고 · 사람이 손으로 고칠 자리가 없다**
// (`~/Library/Application Support/...` 안의 해시 이름 파일이다. 그래서 「편집」 버튼도
// 함께 없앴다). 새 팀원은 자기 기계에서 처음에 한 번 다시 분석해야 한다 — 20초.
// 그 대가로 **남의 프롬프트를 안 건드린다.** 목록은 원래 한 사람의 기계 살림에 가깝고,
// 프롬프트는 팀 전체의 것이라 이 교환을 택했다.
//
// ## 왜 파서와 라이터가 같은 모듈인가
//
// 형식을 정한 것도 쓰는 것도 우리다 (`electron/mcp/saveRunCommands.ts` — 모델은 목록을
// 도구 인자로 주고, 파일은 여기서 짓는다). 둘이 갈리면 조용히 어긋난다: 쓴 것을 못 읽으면
// 패널이 늘 비어 보이고, 사용자에게는 "모델이 분석에 실패했다" 로 보인다. 왕복이 성립하는지는
// `runList.test.ts` 가 잠근다.
//
// ## 형식
//
// ```json
// {
//   "version": 1,
//   "project": "/Users/me/work/repo",
//   "manifest": "3f9a1c2b",
//   "entries": [{ "name": "dev 서버", "command": "npm run dev", "note": "개발 서버" }]
// }
// ```
//
// 마크다운 표를 버리고 JSON 으로 온 것은 **읽는 쪽이 사람에서 앱으로 바뀌었기 때문**이다.
// 표 형식이 감당하던 것들(백틱으로 항목 판정 · `|` 이스케이프 · 절 범위 찾기)은 전부
// "사람이 같은 파일을 함께 쓴다" 는 조건에서 나온 것이라 여기서는 값이 없다.
// `project` 는 사람을 위한 것 하나만 남긴 자리다 — 파일 이름이 해시라(`runListStore.ts`)
// 열어 보고도 누구 목록인지 알 수 없는 것을 막는다.

/** 이 형식의 판. 뒤에 바뀌면 못 읽는 판을 조용히 빈 목록으로 읽지 않고 되묻게 한다. */
const VERSION = 1

export interface RunEntry {
  /** 화면의 줄 이름이자 pty 칸 이름 (`run_project` 의 `name` 과 같은 값) */
  name: string
  command: string
  /** 있으면 이름 옆에 적는다. 없으면 칸이 빈다 */
  note?: string
}

export interface RunList {
  entries: RunEntry[]
  /**
   * 이 목록을 만들 때의 매니페스트 지문 (`runManifest.ts`).
   *
   * null 은 **모르는 것**이지 「안 바뀌었다」가 아니다 — 그때는 다시 확인할지 묻지 않는다.
   * (AGENTS.md 시절에는 사람이 손으로 적은 절이 그랬다. 앱 저장소에는 우리가 적은 것만
   * 들어오므로 지금 이 값이 null 인 경우는 없다시피 하지만, 판정은 그대로 둔다 —
   * 옛 판·손으로 고친 파일이 들어와도 물음이 새지 않는다.)
   */
  manifest: string | null
  /** 누구의 목록인가 (프로젝트 루트 절대경로). **읽는 쪽은 쓰지 않는다** — 사람이 볼 것이다 */
  project: string
}

/** 파일에 적을 글자. 사람이 열어 볼 일이 있어 들여쓰기를 남긴다 (한 번에 몇 줄 안 된다). */
export function serializeRunList(list: RunList): string {
  const entries = list.entries.map((entry) => ({
    name: entry.name,
    command: entry.command,
    ...(entry.note === undefined ? {} : { note: entry.note }),
  }))
  return `${JSON.stringify({ version: VERSION, project: list.project, manifest: list.manifest, entries }, null, 2)}\n`
}

/**
 * 적어 둔 글자를 되읽는다. **읽을 수 없으면 null** — 「목록이 없다」와 같이 다룬다.
 *
 * 깨진 파일에서 빈 목록을 만들어 돌려주지 않는다: 화면이 그것을 「분석했는데 아무것도
 * 못 찾았다」로 그리고, 사용자는 다시 찾아 달라고 할 문을 못 찾는다 (`runSourceLine`).
 */
export function parseRunList(text: string): RunList | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const record = parsed as Record<string, unknown>
  if (record['version'] !== VERSION) return null
  const raw = record['entries']
  if (!Array.isArray(raw)) return null

  // 줄 하나가 망가졌다고 목록 전체를 버리지 않는다 — 나머지는 여전히 누를 수 있다
  const entries: RunEntry[] = []
  for (const item of raw) {
    const entry = entryOf(item)
    if (entry !== null) entries.push(entry)
  }
  return {
    entries,
    manifest: typeof record['manifest'] === 'string' ? record['manifest'] : null,
    project: typeof record['project'] === 'string' ? record['project'] : '',
  }
}

function entryOf(item: unknown): RunEntry | null {
  if (typeof item !== 'object' || item === null) return null
  const record = item as Record<string, unknown>
  const name = asText(record['name'])
  const command = asText(record['command'])
  if (name === '' || command === '') return null

  const note = asText(record['note'])
  return note === '' ? { name, command } : { name, command, note }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
