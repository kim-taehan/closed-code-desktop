import { runGit } from './gitRunner'
import { splitHunks, joinHunk } from '../../shared/git/hunkSplit'
import type { GitActionResult } from '../../shared/ipc/gitPayloads'

// diff 덩어리(hunk) 하나만 담기·되돌리기.
//
// **화면이 보낸 패치 문자열을 믿지 않는다** (설계 §2 결정 #5). 화면은 무엇을 골랐는지만
// 알린다 — `hunkIndex`(몇 번째 덩어리인가)와 `hunkText`(그 덩어리 원문, 머리+본문).
// 패치는 여기서 원문 diff 를 **다시 읽어** 조립한다. 이유가 셋이다.
//   (a) `parseUnifiedDiff` 는 파일 헤더와 hunk 헤더를 버려 화면에서 되만들 수 없다.
//   (b) 왕복시키면 개행(CRLF·끝 개행 없음)이 어딘가에서 정규화된다.
//   (c) 화면이 diff 를 받은 뒤 파일이 바뀌었을 수 있다 — 아래 두 안전장치가 그것을 잡는다.
//
// 안전장치 2개. 둘 다 **패치를 만들기 전에** 걸러, git 에 아무것도 먹이지 않는다.
//   1. 잘린 diff 는 거절 (결정 #3). 잘린 패치를 apply 하면 파일이 망가진다.
//   2. `hunkIndex` 자리의 덩어리 **원문 전체**가 넘어온 것과 글자 그대로 다르면 거절
//      (결정 #4). 그 사이 파일이 바뀌었다는 뜻이다.
//
//      🔴 **머리 한 줄이 아니라 본문까지 대조한다.** 머리가 막는 것은 "덩어리가 밀린 것"
//      이지 "제자리 내용이 바뀐 것"이 아니다. 화면이 그린 뒤 클릭 전에 그 덩어리가
//      **같은 줄 수로** 바뀌면(포매터·에디터 저장·에이전트 편집) 머리는 그대로다 —
//      그때 담으면 사용자가 못 본 내용이 담기고, 되돌리면 **못 본 변경이 사라진다**
//      (되돌릴 수 없다). QA 결함 D4.
//
//      가르는 규칙은 `shared/git/hunkSplit.ts` 하나뿐이다 — 화면도 같은 것을 쓴다.
//      양쪽에 따로 두면 끝 개행 처리 한 곳만 갈려도 정상 요청이 매번 거절된다.

/** 조립한 패치, 또는 조립하지 못한 사유 */
type PatchBuild = { ok: true; patch: string } | { ok: false; message: string }

/**
 * 덩어리 하나를 인덱스에 담는다 (워킹트리 → 인덱스).
 *
 * `git apply --cached` 는 **인덱스만** 바꾼다. 워킹트리의 나머지 덩어리는 그대로 남는다 —
 * 그게 이 기능의 요점이다.
 */
export async function stageHunk(
  root: string,
  path: string,
  hunkIndex: number,
  hunkText: string,
): Promise<GitActionResult> {
  const build = await buildHunkPatch(root, path, hunkIndex, hunkText)
  if (!build.ok) return { ok: false, message: build.message }
  // 옵션 없는 `apply --cached -` 로 충분하다 (실측). `index` 줄의 후상 해시가
  // 부분 패치라 실제 결과와 안 맞지만 git 은 텍스트 패치에서 그것을 대조하지 않는다.
  // `--unidiff-zero`·`--recount` 는 문맥 3줄짜리 원문 diff 에는 필요 없다.
  return runApply(root, ['apply', '--cached', '-'], build.patch)
}

/**
 * 덩어리 하나를 워킹트리에서 되돌린다.
 *
 * **되돌릴 수 없는 행동이다. 부르는 쪽이 한 번 확인받은 뒤에만 온다** (`gitActions.revert`
 * 와 같은 결). 대상이 인덱스가 아니라 **워킹트리**라 `--cached` 를 붙이지 않는다 —
 * 붙이면 인덱스에서 빼는 전혀 다른 동작이 된다.
 */
export async function revertHunk(
  root: string,
  path: string,
  hunkIndex: number,
  hunkText: string,
): Promise<GitActionResult> {
  const build = await buildHunkPatch(root, path, hunkIndex, hunkText)
  if (!build.ok) return { ok: false, message: build.message }
  // `--reverse` 는 패치를 거꾸로 먹인다. 원문 diff 의 "이후"가 곧 워킹트리라 그대로 맞는다.
  return runApply(root, ['apply', '--reverse', '-'], build.patch)
}

async function buildHunkPatch(
  root: string,
  path: string,
  hunkIndex: number,
  hunkText: string,
): Promise<PatchBuild> {
  // `gitDiff.readGitDiff` 의 인자와 **같아야 한다**. 화면이 본 diff 와 여기서 읽는 diff 가
  // 다른 명령에서 나오면 원문 대조가 무의미해진다.
  const result = await runGit(['diff', '--no-color', '--', path], root)

  if (result.failed !== undefined) return { ok: false, message: result.failed }
  if (result.code !== 0) {
    return { ok: false, message: result.stderr.trim() || 'git diff 실패' }
  }
  if (result.stdoutTruncated === true) {
    // 결정 #3. 잘린 패치는 뒷부분이 통째로 없어 apply 하면 파일이 망가진다.
    return {
      ok: false,
      message:
        '변경 내용이 너무 커서(100KB 초과) 덩어리 단위로 담을 수 없습니다. 파일 전체를 담아 주세요.',
    }
  }
  if (result.stdout === '') {
    return { ok: false, message: '담을 변경이 없습니다. 화면을 새로 고쳐 주세요.' }
  }

  return assemble(result.stdout, hunkIndex, hunkText)
}

/** 원문 diff → 파일 헤더 + 고른 덩어리 하나짜리 최소 패치 */
function assemble(diff: string, hunkIndex: number, hunkText: string): PatchBuild {
  // 화면과 **같은 함수**로 가른다 (`shared/git/hunkSplit.ts`). 규칙이 갈리는 순간
  // 아래 대조가 정상 요청까지 떨어뜨린다.
  const { fileHeader, hunks } = splitHunks(diff)

  // 경로 하나에 파일 항목이 둘 (이름 변경 검출 등). 어느 항목의 몇 번째인지
  // 화면과 합의된 바 없어 조립하지 않는다.
  if (hunks.some((hunk) => hunk.body.some((line) => line.startsWith('diff --git ')))) {
    return { ok: false, message: UNSUPPORTED_MESSAGE }
  }

  // `+++ ` 가 없으면 파일 헤더가 아니다 (바이너리 diff 등). apply 할 대상이 없다.
  if (!fileHeader.some((line) => line.startsWith('+++ '))) {
    return { ok: false, message: UNSUPPORTED_MESSAGE }
  }

  const hunk = hunks[hunkIndex]
  // 결정 #4. 인덱스가 범위를 벗어났거나 **덩어리 원문이 한 글자라도 다르면** 그 사이
  // 파일이 바뀐 것이다. 여기서 멈추므로 git 에는 아무것도 안 먹인다 — 저장소는 부르기
  // 전과 똑같이 남는다. 머리만 보면 제자리 내용 변경(D4)을 통과시킨다.
  if (hunk === undefined || joinHunk(hunk) !== hunkText) {
    return { ok: false, message: STALE_MESSAGE }
  }

  // 마지막 `\n` 이 없으면 git 이 "corrupt patch at line N" 으로 거절한다.
  return { ok: true, patch: `${[...fileHeader, joinHunk(hunk)].join('\n')}\n` }
}

const STALE_MESSAGE =
  '그 사이 파일이 바뀌어 이 덩어리를 담지 못했습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.'

const UNSUPPORTED_MESSAGE = '이 변경은 덩어리 단위로 담을 수 없습니다. 파일 전체를 담아 주세요.'

/** `gitActions.run` 과 같은 결 — 실패는 git stderr 원문 그대로 올린다 */
async function runApply(root: string, args: string[], patch: string): Promise<GitActionResult> {
  const result = await runGit(args, root, patch)
  if (result.failed !== undefined) return { ok: false, message: result.failed }
  if (result.code !== 0) {
    return { ok: false, message: result.stderr.trim() || 'git apply 실패' }
  }
  return { ok: true }
}
