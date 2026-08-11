import {
  isContentRef,
  isEmptyRange,
  type ChangeBlock,
  type MaybeContent,
  type TurnFileChange,
} from '../../shared/protocol/turnReview'

// changeBlocks 를 화면 행으로 편다 (ADR-038 §5).
//
// **diff 를 계산하지 않는다.** 런타임이 준 라인 범위를 그대로 소비한다.
// 여기서 다시 계산하면 런타임과 어긋날 수 있고, 그게 바로 계약을 둔 이유다.

export type DiffRowKind = 'context' | 'add' | 'del' | 'gap'

export interface DiffRow {
  kind: DiffRowKind
  /** 변경 전 파일의 줄 번호 (1-indexed). add 행에는 없다. */
  oldLine?: number
  /** 변경 후 파일의 줄 번호. del 행에는 없다. */
  newLine?: number
  text: string
}

export interface BuildRowsOptions {
  /** 변경 블록 앞뒤로 보여줄 문맥 줄 수 */
  context?: number
}

const DEFAULT_CONTEXT = 3

export type DiffRowsResult =
  | { kind: 'rows'; rows: DiffRow[] }
  /** 전문이 ref 마커라 아직 못 가져왔다 */
  | { kind: 'needs_fetch'; ref: string }
  /** 보여줄 내용이 없다 (delete 등) */
  | { kind: 'unavailable'; reason: string }

/**
 * 파일 하나의 diff 행을 만든다.
 *
 * baseline/modified 가 ref 마커면 본문이 없으므로 조회가 필요하다고 알린다 —
 * 임의로 빈 내용을 그리면 "변경이 없다" 로 잘못 보인다.
 */
export function buildDiffRows(file: TurnFileChange, options: BuildRowsOptions = {}): DiffRowsResult {
  const baselineRef = refOf(file.baseline)
  if (baselineRef) return { kind: 'needs_fetch', ref: baselineRef }

  const modifiedRef = refOf(file.modified)
  if (modifiedRef) return { kind: 'needs_fetch', ref: modifiedRef }

  if (file.operation === 'delete') {
    const removed = typeof file.baseline === 'string' ? file.baseline : ''
    if (!removed) return { kind: 'unavailable', reason: '삭제된 파일의 원본이 없습니다' }
    return {
      kind: 'rows',
      rows: splitLines(removed).map((text, index) => ({ kind: 'del', oldLine: index + 1, text })),
    }
  }

  const oldLines = typeof file.baseline === 'string' ? splitLines(file.baseline) : []
  const newLines = typeof file.modified === 'string' ? splitLines(file.modified) : []
  if (newLines.length === 0 && oldLines.length === 0) {
    return { kind: 'unavailable', reason: '내용을 가져오지 못했습니다' }
  }

  if (file.changeBlocks.length === 0) {
    // 블록이 없으면 변경 위치를 알 수 없다. 전체를 문맥으로 보여준다.
    return {
      kind: 'rows',
      rows: newLines.map((text, index) => ({ kind: 'context', oldLine: index + 1, newLine: index + 1, text })),
    }
  }

  return { kind: 'rows', rows: assemble(oldLines, newLines, file.changeBlocks, options.context ?? DEFAULT_CONTEXT) }
}

/**
 * 블록을 순회하며 문맥·삭제·추가 행을 쌓는다.
 *
 * 블록 사이가 문맥 줄 수보다 멀면 접힘 표시(gap)를 넣는다 —
 * 큰 파일에서 안 바뀐 부분을 다 그리면 정작 변경이 안 보인다.
 */
function assemble(
  oldLines: string[],
  newLines: string[],
  blocks: ChangeBlock[],
  context: number,
): DiffRow[] {
  const rows: DiffRow[] = []
  const sorted = [...blocks].sort((a, b) => startOf(a) - startOf(b))
  let cursorNew = 1 // 아직 출력하지 않은 새 파일 줄

  for (const block of sorted) {
    const blockNewStart = isEmptyRange(block.newRange) ? block.newRange.startLine : block.newRange.startLine
    const contextStart = Math.max(cursorNew, blockNewStart - context)

    if (contextStart > cursorNew) rows.push({ kind: 'gap', text: `⋯ ${contextStart - cursorNew}줄 생략` })
    pushContext(rows, newLines, contextStart, blockNewStart - 1)

    // 삭제된 원본 줄
    if (!isEmptyRange(block.oldRange)) {
      const deleted = block.deletedText !== undefined ? splitLines(block.deletedText) : null
      for (let line = block.oldRange.startLine; line <= block.oldRange.endLine; line++) {
        const offset = line - block.oldRange.startLine
        const text = deleted?.[offset] ?? oldLines[line - 1] ?? ''
        rows.push({ kind: 'del', oldLine: line, text })
      }
    }

    // 추가된 새 줄
    if (!isEmptyRange(block.newRange)) {
      for (let line = block.newRange.startLine; line <= block.newRange.endLine; line++) {
        rows.push({ kind: 'add', newLine: line, text: newLines[line - 1] ?? '' })
      }
      cursorNew = block.newRange.endLine + 1
    } else {
      cursorNew = Math.max(cursorNew, blockNewStart)
    }
  }

  // 마지막 블록 뒤 문맥
  const tailEnd = Math.min(newLines.length, cursorNew + context - 1)
  pushContext(rows, newLines, cursorNew, tailEnd)
  if (tailEnd < newLines.length) {
    rows.push({ kind: 'gap', text: `⋯ ${newLines.length - tailEnd}줄 생략` })
  }

  return rows
}

function pushContext(rows: DiffRow[], newLines: string[], from: number, to: number): void {
  for (let line = from; line <= to; line++) {
    const text = newLines[line - 1]
    if (text === undefined) continue
    rows.push({ kind: 'context', newLine: line, text })
  }
}

function startOf(block: ChangeBlock): number {
  return block.newRange.startLine
}

function refOf(content: MaybeContent): string | null {
  return isContentRef(content) ? content.ref : null
}

/** 마지막 개행으로 생기는 빈 줄은 버린다 — 실제 줄이 아니다 */
function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}
