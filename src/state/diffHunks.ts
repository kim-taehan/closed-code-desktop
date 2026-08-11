import type { DiffRow } from './diffRows'
import { splitHunks, joinHunk } from '../../shared/git/hunkSplit'
import { parseUnifiedDiff } from './unifiedDiff'

// unified diff 원문 → 덩어리(hunk) 단위.
//
// `parseUnifiedDiff` 를 대신하지 않는다. 그쪽은 **행만** 내고 덩어리 머리를 버린다
// (두 덩어리 사이에 `gap` 행 하나를 끼울 뿐이다). 파일을 통째로 그리는 소비자
// (`OpenTab`·`TurnFileDiff`)에는 그것으로 충분하고, 그 반환 모양에 이미 테스트가
// 매달려 있다. 그래서 **여기를 더한다** — 바꾸지 않는다.
//
// 여기가 따로 있는 이유는 **원문**이 필요해서다. main 은 화면이 보낸 `hunkText`(덩어리
// 원문 전체)를 `git diff --no-color` 원문의 같은 자리 덩어리와 **글자 그대로** 대조해,
// 다르면 "그 사이 파일이 바뀌었다"로 보고 거절한다 (`electron/git/gitHunk.ts`).
// 되만들거나 trim 하면 **매번 거절된다.** 그래서 원문에서 그대로 떠서 나른다.
//
// **가르는 일 자체는 여기서 하지 않는다** — `shared/git/hunkSplit.ts` 하나에 있고
// main 도 그것을 부른다. 규칙을 양쪽에 두면 끝 개행 처리 한 곳만 갈려도 대조가 어긋난다.

export interface DiffHunk {
  /** `@@ -12,7 +12,7 @@ …` 원문 한 줄. **손대지 않는다** (위 머리말). 화면 표시용. */
  header: string
  /**
   * 그 덩어리 원문 전체 (머리 + 본문, 끝 개행 없음). **손대지 않는다.**
   *
   * 이것을 그대로 `hunkText` 로 보낸다. 머리 한 줄만 보내면 **제자리 내용 변경**
   * (같은 줄 수로 바뀐 경우)을 main 이 못 잡는다 — QA 결함 D4.
   */
  text: string
  /** 그 덩어리의 행. `parseUnifiedDiff` 가 만든다 — 규칙이 갈리면 안 된다. */
  rows: DiffRow[]
}

/**
 * 원문 diff 를 덩어리로 가른다.
 *
 * 반환 순서가 곧 `hunkIndex` 다 — main 이 같은 원문을 **같은 함수로** 갈라 N번째를
 * 집는다. **담고 나면 그 덩어리가 diff 에서 빠져 뒤 인덱스가 밀리므로**, 담은 뒤에는
 * diff 를 다시 읽어 이 목록을 새로 만들어야 한다 (`useScmDiff` 가 그렇게 한다).
 */
export function splitDiffHunks(text: string): DiffHunk[] {
  return splitHunks(text).hunks.map((hunk) => {
    const raw = joinHunk(hunk)
    return { header: hunk.header, text: raw, rows: parseUnifiedDiff(raw) }
  })
}
