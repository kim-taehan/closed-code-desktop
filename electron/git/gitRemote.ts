import { runGit } from './gitRunner'
import { readGitState } from './gitStatus'
import type { GitState } from '../../shared/git/gitState'
import type { GitActionResult as ActionResult } from './gitActions'

// 원격을 타는 행동 — 푸시·당겨오기·fetch.
//
// gitActions(로컬 인덱스 조작)와 나눈 이유는 성격이 달라서다. 이쪽은 네트워크를
// 타서 느리고, 실패가 흔하며(망 밖), 밖으로 나가면 되돌리기 번거롭다.
// 실패 메시지는 언제나 git stderr 를 그대로 쓴다.

/**
 * 올린다.
 *
 * 업스트림이 없으면 push 자체가 실패한다. 부르는 쪽이 확인을 받은 뒤 setUpstream 을
 * 주면 `-u origin <branch>` 로 만들며 올린다. 브랜치 이름은 지금 상태에서 읽는다 —
 * 화면이 넘긴 값을 믿지 않는다. 그 사이 바뀌었을 수 있다.
 */
export async function push(root: string, setUpstream: boolean): Promise<ActionResult> {
  if (!setUpstream) return run(root, ['push'])

  const state = await readGitState(root)
  if (state.branch === null) {
    return { ok: false, message: '올릴 브랜치를 찾을 수 없습니다 (분리된 HEAD)' }
  }
  return run(root, ['push', '-u', 'origin', state.branch])
}

/** 당겨온다. 충돌이 나면 git 출력이 그대로 실려 온다 — 해결은 터미널에서. */
export function pull(root: string): Promise<ActionResult> {
  return run(root, ['pull'])
}

/**
 * 원격을 확인하고 상태를 다시 읽는다 (⟳ 전용).
 *
 * fetch 가 실패해도(망 밖) 던지지 않는다. 나머지 상태는 그대로 읽어 돌려주고,
 * 화살표만 '확인 안 됨' 으로 둘 수 있도록 fetchFailed 를 함께 준다.
 */
export async function refreshWithFetch(root: string): Promise<GitState> {
  const fetched = await runGit(['fetch'], root)
  const fetchFailed = fetched.failed !== undefined || fetched.code !== 0
  const state = await readGitState(root)
  return fetchFailed ? { ...state, fetchFailed: true } : state
}

async function run(root: string, args: string[]): Promise<ActionResult> {
  const result = await runGit(args, root)
  if (result.failed !== undefined) return { ok: false, message: result.failed }
  if (result.code !== 0) {
    return { ok: false, message: result.stderr.trim() || result.stdout.trim() || 'git 명령이 실패했습니다' }
  }
  return { ok: true }
}
