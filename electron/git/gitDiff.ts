import { readFile } from 'node:fs/promises'
import { describeError } from '../../shared/errors/describeError'
import { join } from 'node:path'
import { runGit, succeeded } from './gitRunner'
import type { GitDiffResultPayload } from '../../shared/ipc/gitPayloads'

// 파일 하나의 diff.
//
// 어느 묶음에서 눌렀는지에 따라 **다른 것을 묻는다** (설계 §4):
//   변경사항   → `git diff`           인덱스 대비, 아직 안 담은 변경
//   스테이지됨 → `git diff --staged`  HEAD 대비, 이번 커밋에 담길 것
// 같은 파일이라도 둘의 내용이 다르다.

/** 아주 큰 파일은 잘라 보낸다 — 화면이 먹지도 못할 양을 IPC 로 나르지 않는다 */
const MAX_BYTES = 400_000

export async function readGitDiff(
  root: string,
  path: string,
  staged: boolean,
): Promise<GitDiffResultPayload> {
  const args = ['diff', '--no-color']
  if (staged) args.push('--staged')
  // `--` 로 경로를 끊는다. 파일명이 브랜치 이름과 같아도 git 이 헷갈리지 않는다.
  args.push('--', path)

  const result = await runGit(args, root)
  if (result.failed !== undefined) {
    return { ok: false, diff: '', reason: result.failed }
  }
  if (result.code !== 0) {
    return { ok: false, diff: '', reason: result.stderr.trim() || 'git diff 실패' }
  }

  // 추적 안 되는 파일은 git 이 아무것도 내놓지 않는다 (비교 대상이 없다).
  // 빈 화면을 주면 "변경이 없다" 로 오해하므로 내용을 그대로 보낸다.
  //
  // 🔴 **빈 출력만으로 "추적 안 됨" 을 판정하지 않는다.** 추적 중인 파일도 변경이
  // 없으면 똑같이 빈 출력이다 — 마지막 덩어리까지 담은 직후 diff 를 다시 읽는
  // 자리가 정확히 그것이고, hunk 흐름이 이 경로를 새로 열었다. 그때 내용을 보내면
  // 아무것도 안 바뀐 파일 전체가 "새 파일" 로 그려진다. 그래서 인덱스에 있는지를
  // `ls-files` 로 따로 묻는다 (`-z` 로 파일명 인용을 끈다 — 있고 없고만 본다).
  // 이 질문 자체가 실패하면 예전대로 내용을 보낸다 — 판정 근거가 없는 쪽에서
  // 빈 화면을 주는 것보다는 낫다.
  if (result.stdout === '' && !staged) {
    const tracked = await runGit(['ls-files', '-z', '--', path], root)
    if (succeeded(tracked) && tracked.stdout !== '') return { ok: true, diff: '' }
    return readContent(root, path)
  }

  return { ok: true, diff: result.stdout }
}

async function readContent(root: string, path: string): Promise<GitDiffResultPayload> {
  try {
    const text = await readFile(join(root, path), 'utf8')
    return { ok: true, diff: text.slice(0, MAX_BYTES), untracked: true }
  } catch (error) {
    // 방금 지워졌거나 바이너리일 수 있다. 사유를 그대로 넘긴다.
    return { ok: false, diff: '', reason: describeError(error) }
  }
}
