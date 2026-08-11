import { runGit } from './gitRunner'
import { isGitRepo } from './gitRepo'
import {
  EMPTY_GIT_STATE,
  type GitFileEntry,
  type GitFileStatus,
  type GitState,
} from '../../shared/git/gitState'

// `git status` 읽기.
//
// `--porcelain=v1 -z --branch` 를 쓴다.
//   -z       NUL 구분. 이게 없으면 git 이 파일명을 따옴표로 감싸고 이스케이프해서
//            줄바꿈·따옴표·한글이 든 이름을 되돌릴 수 없다.
//   --branch 브랜치·업스트림·ahead/behind 를 같은 호출에서 받는다. 호출을 나누면
//            두 값이 서로 다른 시점을 가리킬 수 있다.
//   -uall    추적 안 되는 폴더를 **펼친다**. 기본값은 `src/` 한 줄로 접는데,
//            접힌 폴더는 diff 를 볼 수도 파일 하나만 담을 수도 없다.
//            .gitignore 는 그대로 지켜지므로 node_modules 가 쏟아지지는 않는다.
//
// **`git fetch` 를 여기서 돌리지 않는다.** ahead/behind 는 마지막으로 받아온 원격
// 기준이다. 네트워크를 타는 호출을 상태 조회에 섞으면 패널을 열 때마다 멎는다.

export async function readGitState(root: string): Promise<GitState> {
  if (!(await isGitRepo(root))) return { ...EMPTY_GIT_STATE }

  const result = await runGit(['status', '--porcelain=v1', '-z', '--branch', '-uall'], root)
  if (result.failed !== undefined) {
    return { ...EMPTY_GIT_STATE, isRepo: true, error: gitMissing(result.failed) }
  }
  if (result.code !== 0) {
    return { ...EMPTY_GIT_STATE, isRepo: true, error: result.stderr.trim() || 'git status 실패' }
  }

  return parseStatus(result.stdout)
}

function gitMissing(reason: string): string {
  return reason.includes('ENOENT') ? 'git 을 찾을 수 없습니다' : reason
}

export function parseStatus(stdout: string): GitState {
  const state: GitState = { ...EMPTY_GIT_STATE, isRepo: true, staged: [], unstaged: [] }
  // 마지막 항목 뒤에도 NUL 이 붙어 빈 조각이 남는다
  const parts = stdout.split('\0')

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part === undefined || part === '') continue

    if (part.startsWith('## ')) {
      applyBranch(state, part.slice(3))
      continue
    }

    // "XY path" — 코드 두 글자 다음에 공백 하나
    const x = part.charAt(0)
    const y = part.charAt(1)
    const path = part.slice(3)
    if (path === '') continue

    if (x === '?' && y === '?') {
      state.unstaged.push({ path, status: 'untracked' })
      continue
    }

    if (isConflict(x, y)) {
      // 충돌은 담을 수 없는 상태다. 양쪽에 나누지 않고 변경사항에만 둔다.
      state.unstaged.push({ path, status: 'conflicted' })
      continue
    }

    // 이름 바뀜은 -z 에서 **두 항목**으로 온다 — 새 이름 다음 조각이 옛 이름이다
    let oldPath: string | undefined
    if (x === 'R' || x === 'C') {
      index += 1
      oldPath = parts[index]
    }

    // 한 파일이 양쪽에 다 들어갈 수 있다 (MM: 담아 두고 또 고친 것).
    // 억지로 한쪽에 몰면 사실과 어긋난다.
    if (x !== ' ') {
      state.staged.push(entry(path, x, oldPath))
    }
    if (y !== ' ') {
      state.unstaged.push(entry(path, y))
    }
  }

  return state
}

/** 충돌 코드 (git status 문서의 unmerged 조합) */
function isConflict(x: string, y: string): boolean {
  if (x === 'U' || y === 'U') return true
  return (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
}

function entry(path: string, code: string, oldPath?: string): GitFileEntry {
  return {
    path,
    status: statusOf(code),
    ...(oldPath !== undefined ? { oldPath } : {}),
  }
}

function statusOf(code: string): GitFileStatus {
  switch (code) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
    case 'C':
      return 'renamed'
    default:
      return 'modified'
  }
}

/**
 * `## main...origin/main [ahead 1, behind 2]` 를 판다.
 *
 * 변형이 셋 더 있다:
 *   `## main`                        업스트림 없음
 *   `## HEAD (no branch)`            분리된 HEAD
 *   `## No commits yet on main`      커밋이 하나도 없음
 */
function applyBranch(state: GitState, line: string): void {
  const noCommits = line.match(/^No commits yet on (.+)$/)
  if (noCommits) {
    state.branch = head(noCommits[1] ?? '')
    return
  }

  if (line.startsWith('HEAD (no branch)')) {
    state.branch = null
    return
  }

  const [names, tail] = splitAtBracket(line)
  const [branch, upstream] = names.split('...')
  state.branch = head(branch ?? '')
  state.upstream = upstream !== undefined && upstream !== '' ? upstream : null

  state.ahead = countIn(tail, 'ahead')
  state.behind = countIn(tail, 'behind')
}

function splitAtBracket(line: string): [string, string] {
  const at = line.indexOf(' [')
  return at === -1 ? [line, ''] : [line.slice(0, at), line.slice(at)]
}

function countIn(tail: string, key: 'ahead' | 'behind'): number {
  const match = tail.match(new RegExp(`${key} (\\d+)`))
  return match ? Number(match[1]) : 0
}

/** 이름 뒤에 다른 것이 붙어 오는 경우를 잘라낸다 */
function head(value: string): string | null {
  const name = value.trim()
  return name === '' ? null : name
}
