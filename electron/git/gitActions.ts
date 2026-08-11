import { runGit } from './gitRunner'
import type { GitActionResult } from '../../shared/ipc/gitPayloads'

export type { GitActionResult }

// 저장소를 바꾸는 행동.
//
// 실패해도 예외를 던지지 않고 `{ ok: false, message }` 로 돌려준다.
// **메시지는 git 이 낸 stderr 를 그대로** 쓴다 — 우리가 고쳐 쓰면 검색해서
// 찾아볼 수 없는 문장이 된다.
//
// 경로는 항상 `--` 뒤에 둔다. 파일명이 `-` 로 시작하면 옵션으로 먹힌다.

/** 체크 → 인덱스에 담는다 */
export function stage(root: string, path: string): Promise<GitActionResult> {
  return run(root, ['add', '--', path])
}

/** 해제 → 인덱스에서 뺀다. 작업트리 수정은 건드리지 않는다. */
export function unstage(root: string, path: string): Promise<GitActionResult> {
  return run(root, ['restore', '--staged', '--', path])
}

/**
 * 되돌리기 → 작업트리를 인덱스(또는 HEAD)로 되돌린다.
 *
 * 되돌릴 수 없는 행동이라 부르는 쪽이 한 번 확인받은 뒤에만 온다.
 * 추적 안 되는 파일에는 쓰지 않는다 — 그건 되돌리기가 아니라 삭제다.
 */
export function revert(root: string, path: string): Promise<GitActionResult> {
  return run(root, ['restore', '--', path])
}

/**
 * 커밋한다. **커밋 시점에 따로 add 하지 않는다** — 인덱스에 있는 것을 그대로 담는다.
 * 무엇이 들어갈지는 사용자가 체크로 이미 정했다.
 */
export function commit(root: string, message: string): Promise<GitActionResult> {
  return run(root, ['commit', '-m', message])
}

/**
 * 묶음 액션 — 변경사항을 전부 담는다.
 *
 * `-A` 라 **추적 안 되는 파일과 삭제까지** 들어간다. 파일별 `add` 를 N 번 도는 것과
 * 결과가 다르다 (그쪽은 삭제를 못 담는 git 버전이 있다).
 */
export function stageAll(root: string): Promise<GitActionResult> {
  return run(root, ['add', '-A'])
}

/**
 * 묶음 액션 — 인덱스를 통째로 비운다. 작업트리 수정은 건드리지 않는다.
 *
 * ⚠ 커밋이 하나도 없는 저장소에서는 git 이 `could not resolve HEAD` 로 거절한다
 * (실측, exit 128). 첫 커밋 전에는 되돌릴 인덱스가 없다는 뜻이라 그대로 알린다.
 */
export function unstageAll(root: string): Promise<GitActionResult> {
  return run(root, ['restore', '--staged', '--', '.'])
}

/**
 * 직전 커밋을 새 메시지로 다시 만든다. 인덱스에 담긴 것이 있으면 같이 들어간다.
 *
 * 이미 올린 커밋에 쓰면 원격과 갈라진다 — 되돌릴 수 없는 행동이라
 * 부르는 쪽이 한 번 확인받은 뒤에만 온다 (`revert` 와 같은 결).
 */
export function amend(root: string, message: string): Promise<GitActionResult> {
  return run(root, ['commit', '--amend', '-m', message])
}

/**
 * 커밋 취소 — 커밋만 무르고 변경은 **인덱스에 담긴 채로** 남긴다 (`--soft`).
 * 되돌리기가 아니라 "담은 상태로 되감기"다. 작업한 내용은 사라지지 않는다.
 */
export function undoCommit(root: string): Promise<GitActionResult> {
  return run(root, ['reset', '--soft', 'HEAD~1'])
}

async function run(root: string, args: string[]): Promise<GitActionResult> {
  const result = await runGit(args, root)
  if (result.failed !== undefined) {
    return { ok: false, message: result.failed }
  }
  if (result.code !== 0) {
    return { ok: false, message: result.stderr.trim() || 'git 명령이 실패했습니다' }
  }
  return { ok: true }
}
