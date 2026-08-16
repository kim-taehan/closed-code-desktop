import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  manifestFingerprint,
  MANIFEST_FILES,
  MANIFEST_MAX_BYTES,
} from '../../shared/run/runManifest'
import { parseRunSection, writeRunSection, type RunEntry } from '../../shared/run/runSection'
import { assertCommandLine, assertPaneName } from './runProject'

// `save_run_commands` — 모델이 알아낸 실행 방법을 **AGENTS.md 에 적는다** (설계 §2).
//
// ## 왜 도구인가 (모델이 직접 파일을 고치게 두지 않는 이유)
//
// 모델도 자기 편집 도구로 AGENTS.md 를 고칠 수 있다. 그런데 그렇게 하면 **쓰는 형식이
// 매번 모델의 취향이 된다** — 우리 파서는 표를 읽는데 모델은 목록으로 적고, 목록으로 적힌
// 날 패널은 그냥 빈 채로 뜬다. 사용자에게는 "분석에 실패했다" 로 보이고 실제로는 성공했다.
// 그래서 **모델은 목록만 주고 마크다운은 우리가 짓는다** (`shared/run/runSection.ts`).
//
// ## 지문은 여기서 잰다
//
// 모델이 무엇을 읽었는지가 아니라 **지금 디스크의 매니페스트**가 기준이다. 모델이 읽은
// 것을 믿으면 읽지 않은 파일이 지문에서 빠져, 그 파일이 바뀐 날 아무도 다시 묻지 않는다.
//
// **AGENTS.md 가 없으면 만든다.** 「실행」 절만 든 파일이 새로 생기는 것이고, 그것이 이
// 기능이 캐시 대신 고른 자리다 (설계 §2 — 파일이 곧 캐시다).

/** 목록이 이보다 길면 화면에서도 못 읽고, 대개 모델이 스크립트를 통째로 옮겨 적은 것이다. */
const MAX_ENTRIES = 20

export const AGENTS_FILE = 'AGENTS.md'

export function runCommandsInput(args: Record<string, unknown>): RunEntry[] {
  const raw = args['commands']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('commands 가 없습니다 — 적을 것이 없으면 이 도구를 부르지 마세요')
  }
  if (raw.length > MAX_ENTRIES) {
    throw new Error(`commands 는 ${MAX_ENTRIES}개까지입니다 — 사람이 사이드바에서 고르는 목록입니다`)
  }

  const entries: RunEntry[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const entry = entryOf(item)
    // 같은 이름이 둘이면 칸 하나를 둘이 가리킨다 — ▶ 를 눌러도 하나만 뜨고 다른 줄은
    // 영영 「멈춤」으로 남는다. 표에 들어가기 전에 막는 편이 낫다.
    if (seen.has(entry.name)) throw new Error(`이름이 겹칩니다: ${entry.name}`)
    seen.add(entry.name)
    entries.push(entry)
  }
  return entries
}

function entryOf(item: unknown): RunEntry {
  if (typeof item !== 'object' || item === null) throw new Error('commands 의 항목은 객체여야 합니다')
  const record = item as Record<string, unknown>
  const name = asString(record['name'], 'name')
  const command = asString(record['command'], 'command')
  // **`run_project` 와 같은 규칙을 쓴다** — 표에서는 받아 놓고 ▶ 에서 거절하면 안 된다.
  assertPaneName(name)
  assertCommandLine(command)

  const note = typeof record['note'] === 'string' ? record['note'].trim() : ''
  return note === '' ? { name, command } : { name, command, note }
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} 이(가) 없습니다`)
  return value.trim()
}

export interface SavedRunCommands {
  /** 프로젝트 루트 기준 상대경로 — 모델이 사용자에게 어디를 고쳤는지 말할 수 있어야 한다 */
  path: string
  entries: RunEntry[]
  manifest: string
  /** 절이 이미 있었나. 「처음 적었다」와 「고쳐 적었다」는 사용자에게 다른 말이다 */
  replaced: boolean
}

/** AGENTS.md 의 「실행」 절을 이 목록으로 갈아 끼운다. 절 밖은 그대로 둔다. */
export async function saveRunCommands(root: string, entries: RunEntry[]): Promise<SavedRunCommands> {
  const path = join(root, AGENTS_FILE)
  const before = await readAgents(path)
  const manifest = manifestFingerprint(await readManifests(root))
  const after = writeRunSection(before, { entries, manifest })

  await writeFile(path, after, 'utf8')
  return { path: AGENTS_FILE, entries, manifest, replaced: parseRunSection(before) !== null }
}

/**
 * 있는 그대로. **없으면 빈 문자열이고, 그 밖의 실패는 던진다.**
 *
 * ⚠️ 이 갈래가 이 파일에서 가장 위험한 자리다: 읽기 실패를 「빈 파일」로 삼키면 뒤의
 * `writeRunSection('')` 이 절 하나짜리 문서를 만들고, 그것으로 **남의 글이 든 AGENTS.md 를
 * 통째로 덮어쓴다.** 권한이 없거나 디렉토리인 경우가 그렇다 — 없는 것과 못 읽는 것은
 * 여기서 반드시 갈라야 한다.
 */
async function readAgents(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw new Error(`${AGENTS_FILE} 을(를) 읽지 못해 아무것도 적지 않았습니다: ${String(error)}`)
  }
}

/**
 * 지문에 넣을 매니페스트들. **없거나 못 읽는 파일은 조용히 빠진다** — 후보 목록은 여러
 * 생태계를 함께 담고 있어 한 프로젝트에서 대부분이 없는 것이 정상이고, 화면 쪽 읽기도
 * 실패한 파일을 같은 방식으로 뺀다 (`useRunList.isStale` — 둘이 갈리면 지문이 안 맞는다).
 */
async function readManifests(root: string): Promise<{ path: string; text: string }[]> {
  const found: { path: string; text: string }[] = []
  for (const name of MANIFEST_FILES) {
    const text = await readCapped(join(root, name))
    if (text !== '') found.push({ path: name, text })
  }
  return found
}

/** 상한을 넘으면 뺀다 — 화면 쪽 읽기가 그렇게 하기 때문이다 (`MANIFEST_MAX_BYTES`). */
async function readCapped(path: string): Promise<string> {
  try {
    if ((await stat(path)).size > MANIFEST_MAX_BYTES) return ''
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}
