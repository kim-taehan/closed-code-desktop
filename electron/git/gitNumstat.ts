import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runGit } from './gitRunner'

// 파일별 `+추가 −삭제` 줄 수.
//
// 상태(`gitStatus.ts`)와 **호출을 나눈다.** `status --porcelain` 은 줄 수를 내지 않고,
// diff 쪽은 어느 묶음이냐에 따라 다른 것을 묻기 때문이다 (`gitDiff.ts` 와 같은 갈림):
//   변경사항   → `diff --numstat`
//   스테이지됨 → `diff --numstat --staged`
// 워킹트리 전체 numstat 은 이 레포 기준 409B 라 두 번 돌려도 값싸다.
//
// `-z` 를 쓴다. 없으면 git 이 파일명을 따옴표로 감싸 이스케이프해서
// 공백·따옴표·한글이 든 이름을 되돌릴 수 없다 (`gitStatus.ts` 와 같은 이유).

export interface GitLineCount {
  insertions: number
  deletions: number
}

export interface GitNumstat {
  /** 아직 안 담은 변경 + 추적 안 되는 파일 */
  unstaged: Map<string, GitLineCount>
  /** 이번 커밋에 담길 것 */
  staged: Map<string, GitLineCount>
}

/**
 * @param untracked 추적 안 되는 파일 경로. **numstat 에는 안 나오므로**
 *   부르는 쪽이 `GitState.unstaged` 에서 골라 넘겨야 한다.
 */
export async function readNumstat(root: string, untracked: string[] = []): Promise<GitNumstat> {
  const [work, index, added] = await Promise.all([
    runGit(['diff', '--numstat', '-z'], root),
    runGit(['diff', '--numstat', '-z', '--staged'], root),
    Promise.all(untracked.map((path) => countNewFile(join(root, path)))),
  ])

  const unstaged = parseNumstat(work.stdout)
  untracked.forEach((path, at) => {
    const count = added[at]
    if (count) unstaged.set(path, count)
  })

  return { unstaged, staged: parseNumstat(index.stdout) }
}

/**
 * `-z` numstat 을 판다. 레코드는 `추가\t삭제\t경로\0`.
 *
 * **이름 바뀜은 모양이 다르다** — 세 번째 칸이 비고 옛 이름·새 이름이 조각 둘로 뒤따른다
 * (`2\t0\t\0old\0new\0`, 실측). 새 이름을 키로 쓴다 — 화면의 행이 새 이름이다.
 *
 * 바이너리는 `-\t-` 로 온다. 줄 수라는 게 없으므로 **항목을 아예 넣지 않는다** —
 * 0 으로 넣으면 화면에 `+0 −0` 이 떠서 "변경 없음" 으로 읽힌다.
 */
export function parseNumstat(stdout: string): Map<string, GitLineCount> {
  const counts = new Map<string, GitLineCount>()
  // 마지막 레코드 뒤에도 NUL 이 붙어 빈 조각이 남는다
  const parts = stdout.split('\0')

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part === undefined || part === '') continue

    const firstTab = part.indexOf('\t')
    const secondTab = part.indexOf('\t', firstTab + 1)
    if (firstTab === -1 || secondTab === -1) continue

    const added = part.slice(0, firstTab)
    const deleted = part.slice(firstTab + 1, secondTab)
    let path = part.slice(secondTab + 1)

    if (path === '') {
      // 이름 바뀜: 다음 조각이 옛 이름, 그 다음이 새 이름
      index += 2
      path = parts[index] ?? ''
    }
    if (path === '' || added === '-' || deleted === '-') continue

    counts.set(path, { insertions: Number(added), deletions: Number(deleted) })
  }

  return counts
}

/** git 이 바이너리인지 볼 때 훑는 길이. 이 앞쪽에만 NUL 이 없으면 텍스트로 센다. */
const BINARY_SCAN = 8000

/**
 * 추적 안 되는 파일의 추가 줄 수.
 *
 * **`diff --numstat --no-index /dev/null <파일>` 대신 직접 센다.** 실측으로 골랐다:
 *   - `--no-index` 는 경로를 하나씩만 받아 파일마다 git 을 새로 띄운다 (50개에 0.39초).
 *     사이드바는 모든 행동 뒤에 다시 그려져 그 비용이 매번 든다.
 *   - 셈법이 같다. 추적 안 되는 파일은 전부 추가 줄이라 개행 세기가 곧 numstat 이다.
 *     끝 개행 없음 → 1, 빈 파일 → 0, CRLF → 개행 기준. 셋 다 `--no-index` 와 대조했다.
 *   - 바이너리 판정도 같다. git 은 **앞 8000바이트**에 NUL 이 있을 때만 바이너리로 보며,
 *     9000바이트째 NUL 은 텍스트로 셌다 (실측).
 * `gitDiff.ts:43` 도 추적 안 되는 파일은 readFile 로 직접 읽는다 — 같은 결이다.
 */
async function countNewFile(file: string): Promise<GitLineCount | null> {
  try {
    const buffer = await readFile(file)
    if (buffer.subarray(0, BINARY_SCAN).includes(0)) return null

    const text = buffer.toString('utf8')
    if (text === '') return { insertions: 0, deletions: 0 }
    const breaks = text.split('\n').length - 1
    return { insertions: text.endsWith('\n') ? breaks : breaks + 1, deletions: 0 }
  } catch {
    // 방금 지워졌거나 디렉터리다. 수치 없이 넘어간다 — 배지가 안 뜰 뿐이다.
    return null
  }
}
