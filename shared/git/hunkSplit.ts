// unified diff 원문 → 덩어리(hunk) 단위. **main 과 화면이 같은 것을 쓴다.**
//
// 규칙을 여기 하나로 모은 이유가 전부다. 화면이 그린 덩어리와 main 이 담는 덩어리가
// **글자 그대로 같음**을 보장하는 것이 이 기능의 유일한 안전선인데(`gitHunk.ts` 머리말),
// 가르는 규칙을 양쪽에 따로 두면 한쪽이 끝 개행을 버리고 다른 쪽이 남기는 순간
// **정상 요청까지 매번 거절된다**. 실제로 그렇게 갈려 있었다 — main 은 `pop()` 했고
// 화면은 안 했다.
//
// 규칙 한 문장:
// **원문을 `\n` 으로 가르고 끝 개행이 만든 마지막 빈 조각 하나만 버린 뒤, 0열이 `@@`
// 인 줄에서 새 덩어리를 열며, 덩어리 원문은 머리 줄과 그 뒤 줄들을 다시 `\n` 으로 이은
// 것(끝 개행 없음)이다.**

export interface RawHunk {
  /** `@@ -12,7 +12,7 @@ …` 원문 한 줄 */
  header: string
  /** 머리 다음부터 다음 머리 직전까지. `\ No newline at end of file` 도 여기 들어간다 */
  body: string[]
}

export interface SplitDiff {
  /** 첫 `@@` 앞 (`diff --git`·`index`·`---`·`+++`). 덩어리가 아니다 */
  fileHeader: string[]
  /** 순서가 곧 `hunkIndex` 다 */
  hunks: RawHunk[]
}

/** 원문 diff 를 파일 헤더와 덩어리들로 가른다 (위 머리말의 규칙 그대로) */
export function splitHunks(diff: string): SplitDiff {
  const lines = diff.split('\n')
  // `split` 이 마지막 개행 뒤에 만든 빈 조각. 남기면 덩어리 원문 끝에 빈 줄이 하나
  // 더 붙어, 같은 diff 인데도 양쪽 문자열이 달라진다.
  if (lines[lines.length - 1] === '') lines.pop()

  const fileHeader: string[] = []
  const hunks: RawHunk[] = []
  for (const line of lines) {
    if (isHunkHeader(line)) {
      hunks.push({ header: line, body: [] })
      continue
    }
    const current = hunks[hunks.length - 1]
    if (current === undefined) {
      fileHeader.push(line)
      continue
    }
    current.body.push(line)
  }

  return { fileHeader, hunks }
}

/** 가른 것을 도로 잇는다 — 화면이 나르고 main 이 대조하는 그 문자열 */
export function joinHunk(hunk: RawHunk): string {
  return [hunk.header, ...hunk.body].join('\n')
}

/**
 * 덩어리 머리인가.
 *
 * 본문 줄은 언제나 접두 한 글자(` `/`+`/`-`)나 `\`(끝 개행 없음 표시)로 시작하므로,
 * 0열의 `@@` 는 머리일 수밖에 없다. 원본 소스에 `@@` 로 시작하는 줄이 있어도
 * diff 에서는 접두가 붙어 ` @@…` 가 된다.
 */
function isHunkHeader(line: string): boolean {
  return line.startsWith('@@')
}
