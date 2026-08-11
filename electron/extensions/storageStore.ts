import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// 확장이 자기 결과를 들고 있는 곳 (`davis.storage`).
//
// **확장별 · 프로젝트별로 가른다.** 자식(확장 호스트)은 확장 전부를 한 프로세스에 싣고
// 같은 RPC 통로를 쓰므로, 이름으로 가르지 않으면 `results` 같은 흔한 키가 확장끼리 충돌한다.
// 프로젝트로 한 번 더 가르는 이유는 확장이 여러 프로젝트를 오가며 쓰이기 때문이다 —
// A 를 분석한 결과가 B 에서 보이면 사람이 그것을 B 의 산출물로 읽는다.
//
// **프로젝트 안에 쓰지 않는다.** 분석 대상은 대개 남의 레포이고, 확장이 거기에 파일을
// 만들면 그 레포의 diff 를 더럽힌다. 팀 공유는 저장소가 아니라 **MD 내보내기**가 맡는다
// (`export.save`) — 저장소는 "작업 중인 상태" 만 든다.

/** 값 하나의 상한. 넘으면 거절한다. */
const MAX_BYTES = 8 * 1024 * 1024

/**
 * 저장 경로.
 *
 * 확장 이름과 프로젝트를 **해시로** 접는다. 확장 이름은 매니페스트에서 온 남의 문자열이고
 * 프로젝트 키는 절대경로라, 그대로 폴더 이름에 쓰면 경로 구분자·상위 참조가 섞여 들어온다.
 * 사람이 폴더를 눈으로 찾을 일이 없는 자리라 읽기 좋음을 포기하고 안전을 택한다.
 */
function fileOf(root: string, extension: string, project: string | null): string {
  return join(root, digest(extension), `${digest(project ?? '(프로젝트 없음)')}.json`)
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

export interface ExtensionStorage {
  get(extension: string, project: string | null, key: string): Promise<unknown>
  set(extension: string, project: string | null, key: string, value: unknown): Promise<void>
}

/**
 * 디스크 저장소를 만든다.
 *
 * 한 프로젝트의 값을 **파일 하나에 모은다.** 키마다 파일을 두면 확장이 키를 늘릴 때마다
 * 파일이 늘고, 지울 방법도 같이 필요해진다. 지금 확장이 쓰는 키는 한 자리 수다.
 */
export function createExtensionStorage(root: string): ExtensionStorage {
  /**
   * 파일 하나에 대한 쓰기를 **한 줄로 세운다.**
   *
   * `set` 은 「읽고-고쳐-쓰기」인데 파일 하나에 키를 다 모아 두므로, 겹쳐 들어오면
   * **나중 것이 앞 것을 통째로 덮는다** — 둘 다 같은 옛 덩어리를 읽어 각자 자기 키만
   * 얹어 쓰기 때문이다. 확장이 여러 갈래로 도는 것은 이미 흔한 일이라
   * (`extensions/test-scenario/core/pool.js` 는 넷을 겹쳐 돌린다) 저장한 시나리오가
   * 조용히 사라질 수 있었다. 실제로 시험이 간헐적으로 깨졌고, 그 로그에
   * `rename ... .tmp -> .json` 의 ENOENT 가 남았다 (임시 파일 이름도 공유했다).
   *
   * 열쇠는 **파일 경로**다 — 다른 확장·다른 프로젝트끼리는 서로 기다릴 이유가 없다.
   */
  const writing = new Map<string, Promise<unknown>>()

  return {
    async get(extension, project, key) {
      const bag = await read(fileOf(root, extension, project))
      // 없는 키는 `undefined` 다 — `null` 은 확장이 일부러 넣은 값일 수 있어 구분한다
      return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : undefined
    },

    async set(extension, project, key, value) {
      const path = fileOf(root, extension, project)
      // 실패는 **부르는 쪽에만** 올린다. 줄에 그대로 이어 붙이면 한 번 터진 뒤로 그 파일에
      // 쓰려던 것이 전부 그 실패에 걸린다 (`adapter/storage.js` 의 `indexLock` 과 같은 규칙).
      const mine = (writing.get(path) ?? Promise.resolve()).then(() => writeKey(path, key, value))
      writing.set(
        path,
        mine.catch(() => {}),
      )
      return mine
    },
  }
}

/** 키 하나를 갈아 끼운다. **부르는 쪽이 한 줄로 세워 준다** — 여기서는 겹침을 다루지 않는다. */
async function writeKey(path: string, key: string, value: unknown): Promise<void> {
  const bag = await read(path)

  if (value === undefined) delete bag[key]
  else bag[key] = value

  const text = JSON.stringify(bag)
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    // 삼키면 다음 실행에서 "저장했는데 없다" 로만 보인다
    throw new Error(`저장 용량을 넘었습니다 (상한 ${Math.round(MAX_BYTES / 1024 / 1024)}MB)`)
  }

  await mkdir(dirname(path), { recursive: true })
  // 임시 파일에 쓰고 갈아끼운다 — 쓰는 중에 앱이 죽으면 원본이 반쪽으로 남는다.
  // `rename` 은 대상이 있어도 덮어쓴다.
  //
  // 이름에 **번호를 붙인다.** 창이 둘이거나(같은 프로젝트를 두 창에서 열 수 있다) 앞 판의
  // 임시 파일이 남아 있으면 같은 이름을 두고 다투게 되고, 그때 한쪽의 `rename` 이
  // 없는 파일을 옮기려다 ENOENT 로 터진다.
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

async function read(path: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    // 아직 없는 것은 정상이다 — 빈 것으로 시작한다
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    // 깨진 파일 때문에 확장이 아무것도 못 하게 두지 않는다. 다음 저장이 덮어쓴다.
    return {}
  }
}
