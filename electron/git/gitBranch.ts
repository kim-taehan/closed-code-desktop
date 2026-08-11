import { runGit } from './gitRunner'
import type { GitBranchEntry, GitBranchListResult } from '../../shared/git/gitRefs'
import type { GitActionResult } from '../../shared/ipc/gitPayloads'

// 브랜치 목록과 브랜치를 바꾸는 행동.
//
// 실패해도 예외를 던지지 않고 `{ ok: false, message }` 로 돌려준다.
// **메시지는 git 이 낸 stderr 를 그대로** 쓴다 — 우리가 고쳐 쓰면 검색해서
// 찾아볼 수 없는 문장이 된다 (`gitActions.ts` 와 같은 결).
//
// 브랜치 이름은 `--` 로 못 끊는다. `git switch -c -- 이름` 은 문법이 아니고,
// git 자체가 `-` 로 시작하는 refname 을 거절한다 (check-ref-format). 그래서
// `-foo` 는 옵션 파싱에서 `error: unknown switch` 로 떨어진다 (실측) — 조용히
// 엉뚱한 일이 벌어지는 자리는 없다.

// `%(refname)` 은 전체 경로(`refs/remotes/origin/x`)라 로컬/원격을 **확실히** 가른다.
// 짧은 이름만으로는 못 가른다 — 로컬에도 `feat/x` 처럼 `/` 가 든 이름이 있다.
const BRANCH_FORMAT =
  '%(HEAD)%00%(refname)%00%(refname:short)%00%(committerdate:iso8601)%00%(upstream:track)'
const BRANCH_FIELDS = 5

/**
 * 로컬 + 원격 추적 브랜치 목록.
 *
 * `%(upstream:track)` 이 브랜치별 ahead/behind 를 한 번에 준다 (`[ahead 1]`, 실측) —
 * 브랜치마다 `rev-list --count` 를 도는 것보다 git 을 한 번만 띄운다.
 */
export async function readBranches(root: string): Promise<GitBranchListResult> {
  const result = await runGit(
    ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes'],
    root,
  )
  if (result.failed !== undefined) return { ok: false, branches: [], message: result.failed }
  if (result.code !== 0) {
    return { ok: false, branches: [], message: result.stderr.trim() || 'git 브랜치 조회 실패' }
  }
  return { ok: true, branches: parseBranchRefs(result.stdout) }
}

/**
 * `for-each-ref` 출력을 판다. 필드는 NUL, **레코드는 줄바꿈**이다 — `for-each-ref`
 * 에는 `-z` 가 없지만 refname 에 줄바꿈이 못 들어가고(check-ref-format) 날짜·추적
 * 문구도 한 줄이라 안전하다.
 */
export function parseBranchRefs(stdout: string): GitBranchEntry[] {
  const entries: GitBranchEntry[] = []

  for (const line of stdout.split('\n')) {
    if (line === '') continue
    const parts = line.split('\0')
    if (parts.length < BRANCH_FIELDS) continue

    const [head, fullRef, name, date, track] = parts
    if (name === undefined || name === '') continue
    // 원격의 기본 브랜치를 가리키는 심볼릭 참조는 브랜치가 아니다 — 목록에 두면
    // 같은 브랜치가 두 번 보인다.
    //
    // ⚠ **짧은 이름으로 거르면 못 잡는다.** `%(refname:short)` 는
    // `refs/remotes/origin/HEAD` 를 `origin/HEAD` 가 아니라 **`origin`** 으로 줄인다
    // (실측). clone 한 저장소마다 `origin` 이라는 가짜 행이 뜨고, 그걸 누르면
    // `trackRemoteBranch(root, 'origin')` 이 로컬 브랜치 `origin` 을 만들어 버린다.
    // 전체 경로로 거른다.
    if ((fullRef ?? '').endsWith('/HEAD')) continue

    entries.push({
      name,
      remote: (fullRef ?? '').startsWith('refs/remotes/'),
      date: date ?? '',
      track: track ?? '',
      current: head === '*',
    })
  }

  return entries
}

/** 이미 있는 브랜치로 전환한다 */
export function switchBranch(root: string, name: string): Promise<GitActionResult> {
  // ⚠ 작업 중 변경이 **전환할 브랜치와 겹칠 때만** 실패한다. 겹치지 않으면 git 이
  // 수정을 그대로 데려간다 (실측). 실패할 때 git 은
  // `error: Your local changes to the following files would be overwritten…` 을 낸다 —
  // 그 문장을 그대로 올린다. 사용자가 검색해 찾을 수 있어야 한다.
  return run(root, ['switch', name])
}

/** 지금 HEAD 에서 새 브랜치를 떠서 전환한다 */
export function createBranch(root: string, name: string): Promise<GitActionResult> {
  return run(root, ['switch', '--create', name])
}

/**
 * 원격 브랜치를 로컬로 받아 전환한다 (`origin/feat` → 로컬 `feat`).
 *
 * 원격 이름만 떼어 로컬 이름으로 쓴다 — `origin/feature/x` 는 `feature/x` 가 된다
 * (첫 조각만 뗀다).
 *
 * ⚠ `/` 가 없는 이름은 **거절한다.** 원격 이름 자체(`origin`)가 넘어오면 로컬 이름도
 * `origin` 이 돼서 `git switch --create origin --track origin` 이 **exit 0 으로 성공한다**
 * (실측) — 쓰레기 브랜치가 생기고 거기로 전환됐는데 화면은 성공으로 읽는다.
 * 목록 쪽에서 그 행을 이미 걸렀지만(`parseBranchRefs`), 조용히 망가지는 값이라
 * 여기서도 막는다.
 */
export function trackRemoteBranch(root: string, remoteRef: string): Promise<GitActionResult> {
  const slash = remoteRef.indexOf('/')
  if (slash === -1) {
    return Promise.resolve({ ok: false, message: `원격 브랜치 이름이 아닙니다: ${remoteRef}` })
  }
  return run(root, ['switch', '--create', remoteRef.slice(slash + 1), '--track', remoteRef])
}

/**
 * 다른 브랜치를 지금 브랜치에 병합한다.
 *
 * 🔴 **`--no-edit` 이 필수다.** 없으면 병합 커밋 메시지 편집기가 떠서 EOF 를 못 받고
 * `runGit` 의 60초 타임아웃을 다 채운 뒤 실패한다 (탐색 §4 경고).
 *
 * 충돌이 나면 `ok:false` 에 git 의 충돌 안내가 실리고 저장소는 충돌 상태로 남는다.
 * 해결은 아직 화면 밖(터미널)이다 — `gitRemote.pull` 과 같은 자리다.
 */
export function mergeBranch(root: string, name: string): Promise<GitActionResult> {
  return run(root, ['merge', '--no-edit', name])
}

/**
 * 브랜치를 지운다 (**안전한 쪽**). 병합 안 된 브랜치는 git 이 거절한다 —
 * `error: the branch 'x' is not fully merged` (실측, exit 1).
 */
export function deleteBranch(root: string, name: string): Promise<GitActionResult> {
  return run(root, ['branch', '--delete', name])
}

/**
 * 브랜치를 강제로 지운다 (`-D`). **병합 안 된 커밋이 사라진다.**
 *
 * 되돌릴 수 없는 행동이라 **부르는 쪽이 한 번 확인받은 뒤에만** 온다
 * (`gitActions.revert`·`amend` 와 같은 규칙). 안전한 쪽과 이름으로 갈라 둔 것은
 * 호출부에서 플래그 하나 차이로 잘못 부르는 일을 막으려는 것이다.
 */
export function forceDeleteBranch(root: string, name: string): Promise<GitActionResult> {
  return run(root, ['branch', '--delete', '--force', name])
}

// `gitRemote.ts:47` 과 같은 **3단 폴백**이다. `gitActions.ts:80` 은 stderr 만 보는데,
// 여기서 그걸 베꼈다가 걸렸다 — **`git merge` 는 충돌 설명을 전부 stdout 으로 낸다**
// (stderr 는 0바이트, exit 1, 실측). stderr 만 보면 사용자가 받는 문장이
// `Auto-merging a.txt / CONFLICT (content): … / Automatic merge failed` 에서
// `git 명령이 실패했습니다` 로 **통째로 뒤바뀐다.**
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
