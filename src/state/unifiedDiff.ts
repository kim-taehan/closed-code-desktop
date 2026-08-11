import type { DiffRow } from './diffRows'

// unified diff 텍스트 → DiffRow[].
//
// `diffRows.ts` 와 나란한 **다른 입구**다. 그쪽은 런타임이 준 changeBlocks 를 먹고,
// 여기는 git 이 준 텍스트를 먹는다. 둘 다 같은 `FileDiffView` 로 흘러간다.
//
// hunk 헤더가 줄 번호의 유일한 근거다. 세어서 맞추려 하면 `\ No newline` 같은
// 메타 줄에서 어긋난다.

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function parseUnifiedDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false

  for (const line of text.split('\n')) {
    const hunk = HUNK.exec(line)
    if (hunk) {
      // hunk 사이는 이어지지 않은 자리다. 첫 hunk 앞에는 두지 않는다.
      if (inHunk) rows.push({ kind: 'gap', text: '' })
      oldLine = Number(hunk[1])
      newLine = Number(hunk[3])
      inHunk = true
      continue
    }

    // 헤더(diff --git, ---, +++, index, new file mode …)는 hunk 전에 나온다
    if (!inHunk) continue

    // "\ No newline at end of file" — 내용이 아니라 메타다. 줄 번호를 올리면 안 된다.
    if (line.startsWith('\\')) continue

    const marker = line.charAt(0)
    const body = line.slice(1)

    if (marker === '+') {
      rows.push({ kind: 'add', newLine, text: body })
      newLine += 1
    } else if (marker === '-') {
      rows.push({ kind: 'del', oldLine, text: body })
      oldLine += 1
    } else if (marker === ' ') {
      rows.push({ kind: 'context', oldLine, newLine, text: body })
      oldLine += 1
      newLine += 1
    } else if (line === '') {
      // 마지막 조각. 진짜 빈 문맥 줄은 ' ' 한 글자로 오므로 여기 오지 않는다.
      continue
    }
  }

  return rows
}

/**
 * 추적 안 되는 파일처럼 비교 대상이 없는 경우.
 *
 * diff 가 아니라 **내용을 그대로** 보여준다. 전부 추가된 것으로 그리면
 * 실제로 커밋에 그렇게 들어가므로 거짓말은 아니다.
 */
export function rowsFromContent(text: string): DiffRow[] {
  return text.split('\n').map((line, index) => ({
    kind: 'add' as const,
    newLine: index + 1,
    text: line,
  }))
}
