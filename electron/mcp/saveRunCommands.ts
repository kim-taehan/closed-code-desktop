import { readRunList, writeRunList } from '../run/runListStore'
import { diskFingerprint } from '../run/runManifestDisk'
import type { RunEntry } from '../../shared/run/runList'
import { assertCommandLine, assertPaneName } from './runProject'

// `save_run_commands` — 모델이 알아낸 실행 방법을 **앱 저장소에 적는다** (설계 §2).
//
// ## 왜 도구인가 (모델이 직접 파일을 고치게 두지 않는 이유)
//
// 모델이 자기 편집 도구로 적으면 **쓰는 형식이 매번 모델의 취향이 된다** — 우리 파서가
// 못 읽는 날 패널은 그냥 빈 채로 뜨고, 사용자에게는 "분석에 실패했다" 로 보인다. 실제로는
// 성공했다. 그래서 **모델은 목록만 주고 파일은 우리가 짓는다** (`shared/run/runList.ts`).
//
// 자리가 앱 저장소로 옮겨 오면서 이 이유가 하나 더 늘었다: **모델은 그 파일에 손이 닿지
// 않는다.** 프로젝트 밖(`~/Library/Application Support/...`)이라 편집 도구로는 못 가고,
// 이 도구가 유일한 문이다.
//
// ## 지문은 여기서 잰다
//
// 모델이 무엇을 읽었는지가 아니라 **지금 디스크의 매니페스트**가 기준이다. 모델이 읽은
// 것을 믿으면 읽지 않은 파일이 지문에서 빠져, 그 파일이 바뀐 날 아무도 다시 묻지 않는다.

/** 목록이 이보다 길면 화면에서도 못 읽고, 대개 모델이 스크립트를 통째로 옮겨 적은 것이다. */
const MAX_ENTRIES = 20

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
    // 영영 「멈춤」으로 남는다. 목록에 들어가기 전에 막는 편이 낫다.
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
  // **`run_project` 와 같은 규칙을 쓴다** — 목록에서는 받아 놓고 ▶ 에서 거절하면 안 된다.
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
  entries: RunEntry[]
  manifest: string
  /** 목록이 이미 있었나. 「처음 적었다」와 「고쳐 적었다」는 사용자에게 다른 말이다 */
  replaced: boolean
}

/** 이 프로젝트의 실행 목록을 이것으로 갈아 끼운다. */
export async function saveRunCommands(
  dir: string,
  root: string,
  entries: RunEntry[],
): Promise<SavedRunCommands> {
  const before = await readRunList(dir, root)
  const manifest = await diskFingerprint(root)

  await writeRunList(dir, { entries, manifest, project: root })
  return { entries, manifest, replaced: before !== null }
}
