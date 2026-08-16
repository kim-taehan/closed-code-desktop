import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseRunList, serializeRunList, type RunList } from '../../shared/run/runList'

// 실행 목록이 실제로 놓이는 자리 — **앱 저장소**다
// (`~/Library/Application Support/open-code-desktop/run-lists/`).
//
// **프로젝트 안에 쓰지 않는다.** 예전 자리(`<프로젝트>/AGENTS.md`)를 버린 이유와
// 그때 잃은 것 셋은 `shared/run/runList.ts` 머리말에 있다 — 여기서 되풀이하지 않는다.
// 자리·이름·원자적 쓰기는 `electron/extensions/storageStore.ts` 의 선례를 그대로 따른다:
// **프로젝트별 파일 하나 · 이름은 해시 · 임시 파일에 쓰고 rename.**

/** 목록 하나의 상한. 넘으면 목록이 아니라 사고다 (`saveRunCommands` 가 20개로 먼저 막는다). */
const MAX_BYTES = 256 * 1024

/**
 * 저장 경로.
 *
 * 프로젝트 키가 **절대경로**라 그대로 폴더 이름에 쓰면 경로 구분자가 섞여 들어온다.
 * 사람이 폴더를 눈으로 찾을 일이 없는 자리라 읽기 좋음을 포기하고 안전을 택한다 —
 * 대신 파일 안에 `project` 를 적어 두어 열어 보면 누구 것인지 알 수 있게 했다.
 *
 * ⚠️ **열쇠는 프로젝트 루트다** (`projectId` 가 아니다). id 는 앱의 프로젝트 목록이
 * 새로 만들면 갈리는 값이고, 같은 폴더를 닫았다 다시 열었을 때 목록이 사라지면 사용자에게는
 * 이유 없이 20초를 다시 태우는 일로 보인다.
 */
export function runListFile(dir: string, projectRoot: string): string {
  return join(dir, `${createHash('sha256').update(projectRoot).digest('hex').slice(0, 32)}.json`)
}

/** 적어 둔 목록. **없거나 읽을 수 없으면 null** — 화면은 그것을 「아직 안 물어봤다」로 그린다. */
export async function readRunList(dir: string, projectRoot: string): Promise<RunList | null> {
  let text: string
  try {
    text = await readFile(runListFile(dir, projectRoot), 'utf8')
  } catch {
    // 아직 없는 것이 정상이다 (프로젝트를 처음 여는 순간이 늘 그렇다)
    return null
  }
  return parseRunList(text)
}

/**
 * 목록을 갈아 끼운다. **통째로 덮어쓴다** — 이 파일에는 우리가 적은 것밖에 없다.
 * (AGENTS.md 시절에는 「절 밖은 한 글자도 안 건드린다」가 이 자리의 가장 무거운 규칙이었다.
 * 남의 글이 같은 파일에 있었기 때문이고, 자리를 옮기며 그 위험이 통째로 없어졌다.)
 */
export async function writeRunList(dir: string, list: RunList): Promise<void> {
  const path = runListFile(dir, list.project)
  const text = serializeRunList(list)
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    throw new Error(`실행 목록이 너무 큽니다 (상한 ${Math.round(MAX_BYTES / 1024)}KB)`)
  }

  await mkdir(dirname(path), { recursive: true })
  // 임시 파일에 쓰고 갈아끼운다 — 쓰는 중에 앱이 죽으면 원본이 반쪽으로 남는다.
  // 이름에 번호를 붙이는 이유는 `storageStore.writeKey` 와 같다(창이 둘일 수 있다).
  const temporary = `${path}.${(tempSeq += 1)}.tmp`
  await writeFile(temporary, text, 'utf8')
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** 임시 파일 이름의 번호. 한 프로세스 안에서만 겹치지 않으면 된다. */
let tempSeq = 0
