import { runGit } from './gitRunner'
import type {
  GitStashEntry,
  GitStashListResult,
  GitStashShowResult,
} from '../../shared/git/gitRefs'
import type { GitActionResult } from '../../shared/ipc/gitPayloads'

// 임시저장(스태시) — 지금 작업을 잠시 치워 두고 나중에 되돌린다.
//
// 실패는 예외가 아니라 `{ ok: false, message }` 다 (`gitActions.ts` 와 같은 결).
//
// **`pop` 을 만들지 않는다.** 화면에는 「복원」 하나뿐인데 `pop` 은 복원과 동시에
// 목록에서 지운다 — 되돌릴 수 없는 삭제가 복원 버튼에 딸려 오는 셈이다.
// 이 레포는 지우는 행동을 확인 뒤에만 부르도록 갈라 둔다(`gitActions.revert`,
// `gitBranch.forceDeleteBranch`). 그래서 `apply`(복원, 목록은 남음) 와
// `drop`(버리기) 을 **따로** 둔다.

const STASH_FORMAT = '%gd%x00%ci%x00%gs'
const STASH_FIELDS = 3

/** 임시저장 목록. 페이징은 없다 — 스태시는 몇 개 수준이다. */
export async function readStashes(root: string): Promise<GitStashListResult> {
  const result = await runGit(['stash', 'list', `--pretty=format:${STASH_FORMAT}`], root)
  if (result.failed !== undefined) return { ok: false, stashes: [], message: result.failed }
  if (result.code !== 0) {
    return { ok: false, stashes: [], message: result.stderr.trim() || 'git 스태시 조회 실패' }
  }
  return { ok: true, stashes: parseStashList(result.stdout) }
}

/**
 * 필드는 NUL, **레코드는 줄바꿈**이다. `stash list` 에는 `-z` 가 없지만 `%gs`
 * (reflog 제목)가 한 줄로 고정이다 — 여러 줄 메시지로 저장해도 git 이 공백으로
 * 이어 한 줄로 만든다 (실측: `-m $'여러\n줄'` → `On main: 여러 줄`).
 */
export function parseStashList(stdout: string): GitStashEntry[] {
  const entries: GitStashEntry[] = []

  for (const line of stdout.split('\n')) {
    if (line === '') continue
    const parts = line.split('\0')
    if (parts.length < STASH_FIELDS) continue

    const [ref, date, label] = parts
    if (ref === undefined || ref === '') continue
    entries.push({ ref, date: date ?? '', label: label ?? '' })
  }

  return entries
}

/**
 * 지금 변경을 치워 둔다.
 *
 * ⚠ **담을 게 없으면 아무것도 안 만들고 성공한다** — git 이 `No local changes to
 * save` 를 내고 **exit 0** 이다 (실측). 실패가 아니므로 그대로 `ok:true` 를 준다.
 * 부르는 쪽은 이 결과만 보고 "저장했다" 고 말하면 안 된다 — 뒤이어 다시 읽은
 * `readStashes()` 로 판단해야 한다. (문구로 가르지 않는 이유는 `gitLog.ts` 의
 * `emptyOrFailure` 와 같다 — git 메시지는 번역된다.)
 *
 * ⚠ 커밋이 하나도 없는 저장소에서는 `You do not have the initial commit yet` 으로
 * **실패한다** (exit 1, 실측). 스태시는 커밋 위에 얹는 것이라 그렇다.
 */
export function stashPush(root: string, message: string): Promise<GitActionResult> {
  return run(root, ['stash', 'push', '-m', message])
}

/**
 * 치워 둔 것을 작업트리로 되돌린다. **목록에는 그대로 남는다** — 버리는 것은
 * `dropStash` 로 따로 부른다 (머리말 참고).
 *
 * `ref` 는 `stash@{0}` 형태다. 셸을 안 거치므로(`gitRunner`) `{}` 가 그대로 간다.
 */
export function applyStash(root: string, ref: string): Promise<GitActionResult> {
  return run(root, ['stash', 'apply', ref])
}

/**
 * 치워 둔 것을 버린다. **되돌릴 수 없다** — 부르는 쪽이 한 번 확인받은 뒤에만 온다
 * (`gitActions.revert`·`gitBranch.forceDeleteBranch` 와 같은 규칙).
 */
export function dropStash(root: string, ref: string): Promise<GitActionResult> {
  return run(root, ['stash', 'drop', ref])
}

/**
 * 치워 둔 것의 내용을 diff 로 본다 (`-p`). 기본 `stash show` 는 요약만 내서
 * 화면에 그릴 게 없다.
 *
 * 커밋 상세와 같이 **잘림을 감춘 채 주지 않는다** — 100KB 를 넘으면 `truncated`.
 */
export async function showStash(root: string, ref: string): Promise<GitStashShowResult> {
  const result = await runGit(['stash', 'show', '-p', '--no-color', ref], root)
  if (result.failed !== undefined) {
    return { ok: false, diff: '', truncated: false, message: result.failed }
  }
  if (result.code !== 0) {
    return {
      ok: false,
      diff: '',
      truncated: false,
      message: result.stderr.trim() || 'git 스태시 내용 조회 실패',
    }
  }
  return { ok: true, diff: result.stdout, truncated: result.stdoutTruncated === true }
}

// `gitRemote.ts:47`·`gitBranch.ts` 와 같은 **3단 폴백**이다. `stash apply` 도 병합을
// 돌리므로 충돌하면 설명이 전부 stdout 으로 온다 (stderr 0바이트, exit 1, 실측).
// stderr 만 보면 `CONFLICT (content): Merge conflict in a.txt` 가 사라지고
// 사용자는 무엇이 충돌했는지 알 수 없는 문장만 받는다.
async function run(root: string, args: string[]): Promise<GitActionResult> {
  const result = await runGit(args, root)
  if (result.failed !== undefined) {
    return { ok: false, message: result.failed }
  }
  if (result.code !== 0) {
    return {
      ok: false,
      message: result.stderr.trim() || result.stdout.trim() || 'git 명령이 실패했습니다',
    }
  }
  return { ok: true }
}
