import { describe, expect, it } from 'vitest'
import { splitDiffHunks } from './diffHunks'
import { parseUnifiedDiff } from './unifiedDiff'

// 이 파일이 잠그는 것은 하나다: **덩어리 원문이 글자 그대로 나간다.**
//
// main 은 `hunkText`(머리+본문)를 `git diff --no-color` 원문의 같은 자리 덩어리와
// 그대로 대조해 다르면 거절한다 (`electron/git/gitHunk.ts`). 되만들거나 다듬으면
// 담기가 **매번** 실패하고, 사용자에게는 "그 사이 파일이 바뀌었다" 는 문구만 보인다.

const DIFF = [
  'diff --git a/src/App.tsx b/src/App.tsx',
  'index 1111111..2222222 100644',
  '--- a/src/App.tsx',
  '+++ b/src/App.tsx',
  '@@ -38,7 +38,9 @@ export function App() {',
  '   const a = 1',
  '-  const b = 2',
  '+  const b = 3',
  '+  const c = 4',
  '@@ -64,6 +66,12 @@ return (',
  '   done',
  '+  more',
  '',
].join('\n')

describe('splitDiffHunks — 머리 원문', () => {
  it('머리를 원문 그대로 나른다 — 뒤에 붙은 문맥 글자까지', () => {
    const hunks = splitDiffHunks(DIFF)

    expect(hunks.map((hunk) => hunk.header)).toEqual([
      '@@ -38,7 +38,9 @@ export function App() {',
      '@@ -64,6 +66,12 @@ return (',
    ])
  })

  it('머리 뒤 문맥을 자르지 않는다 — 되만든 `@@ -38,7 +38,9 @@` 는 거절된다', () => {
    const [first] = splitDiffHunks(DIFF)

    // 줄 번호만 뽑아 되조립한 문자열이면 main 의 글자 대조를 통과하지 못한다.
    expect(first?.header).not.toBe('@@ -38,7 +38,9 @@')
    expect(first?.header.endsWith('export function App() {')).toBe(true)
  })

  it('꼬리 공백도 남긴다 — trim 하면 대조가 어긋난다', () => {
    const [hunk] = splitDiffHunks(['@@ -1 +1 @@ tail  ', '-a', '+b'].join('\n'))

    expect(hunk?.header).toBe('@@ -1 +1 @@ tail  ')
  })

  it('첫 `@@` 앞의 파일 헤더는 덩어리가 아니다', () => {
    expect(splitDiffHunks(DIFF)).toHaveLength(2)
  })

  it('덩어리가 없는 diff 는 빈 목록이다 (바이너리 등)', () => {
    expect(splitDiffHunks('Binary files a/x.png and b/x.png differ\n')).toEqual([])
    expect(splitDiffHunks('')).toEqual([])
  })
})

// 머리만 보내던 시절에는 **제자리 내용 변경**(같은 줄 수로 바뀜)을 main 이 못 잡았다
// — QA 결함 D4. 그래서 본문까지 나른다. 아래는 그 원문이 손타지 않았음을 잠근다.
describe('splitDiffHunks — 덩어리 원문(text)', () => {
  it('머리와 본문을 원문 그대로 잇는다', () => {
    const hunks = splitDiffHunks(DIFF)

    expect(hunks[0]?.text).toBe(
      ['@@ -38,7 +38,9 @@ export function App() {', '   const a = 1', '-  const b = 2', '+  const b = 3', '+  const c = 4'].join('\n'),
    )
  })

  // 🔴 main 은 `\n` 으로 가른 뒤 **끝 개행이 만든 빈 조각을 버린다.** 여기서 남기면
  // 마지막 덩어리만 한 글자 길어져 **정상 담기가 전부 거절된다** (`hunkSplit.ts` 머리말).
  it('끝 개행이 만든 빈 줄을 마지막 덩어리에 붙이지 않는다', () => {
    const hunks = splitDiffHunks(DIFF)

    expect(hunks[1]?.text).toBe('@@ -64,6 +66,12 @@ return (\n   done\n+  more')
    expect(hunks[1]?.text.endsWith('\n')).toBe(false)
  })

  it('`\\ No newline at end of file` 도 본문에 남긴다 — 흘리면 대조가 어긋난다', () => {
    const [hunk] = splitDiffHunks('@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n')

    expect(hunk?.text).toBe('@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file')
  })

  it('CRLF 의 `\\r` 을 본문에 그대로 남긴다', () => {
    const [hunk] = splitDiffHunks('@@ -1 +1 @@\r\n-a\r\n+b\r\n')

    expect(hunk?.text).toBe('@@ -1 +1 @@\r\n-a\r\n+b\r')
  })

  it('머리는 text 의 첫 줄이다 — 둘이 갈리면 대조 기준이 둘이 된다', () => {
    for (const hunk of splitDiffHunks(DIFF)) {
      expect(hunk.text.split('\n')[0]).toBe(hunk.header)
    }
  })
})

describe('splitDiffHunks — 행', () => {
  it('덩어리마다 그 덩어리의 행만 담는다', () => {
    const hunks = splitDiffHunks(DIFF)

    expect(hunks[0]?.rows.map((row) => row.kind)).toEqual(['context', 'del', 'add', 'add'])
    expect(hunks[1]?.rows.map((row) => row.kind)).toEqual(['context', 'add'])
  })

  it('줄 번호는 머리에서 나온다 — 덩어리를 갈라도 이어진다', () => {
    const hunks = splitDiffHunks(DIFF)

    expect(hunks[0]?.rows[0]).toEqual({ kind: 'context', oldLine: 38, newLine: 38, text: '  const a = 1' })
    expect(hunks[1]?.rows[0]).toEqual({ kind: 'context', oldLine: 64, newLine: 66, text: '  done' })
  })

  // 두 파서가 갈리면 화면의 행과 main 이 담는 덩어리가 어긋난다.
  it('전체를 이어 붙이면 parseUnifiedDiff 와 같다 (덩어리 사이 gap 만 다르다)', () => {
    const joined = splitDiffHunks(DIFF).flatMap((hunk) => hunk.rows)
    const whole = parseUnifiedDiff(DIFF).filter((row) => row.kind !== 'gap')

    expect(joined).toEqual(whole)
  })

  it('덩어리 사이에는 gap 을 넣지 않는다 — 덩어리마다 따로 그리므로 이어짐이 없다', () => {
    const hunks = splitDiffHunks(DIFF)

    expect(hunks.every((hunk) => hunk.rows.every((row) => row.kind !== 'gap'))).toBe(true)
  })
})
