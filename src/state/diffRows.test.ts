import { describe, expect, it } from 'vitest'
import { parseTurnReview } from '../../shared/protocol/parseTurnReview'
import type { TurnFileChange } from '../../shared/protocol/turnReview'
import { buildDiffRows, type DiffRow } from './diffRows'

// changeBlocks → 화면 행.
// **diff 를 계산하지 않는다** — 런타임이 준 범위를 그대로 편다.

function fileOf(raw: Record<string, unknown>): TurnFileChange {
  return parseTurnReview({ turnId: 't1', files: [{ path: 'a.ts', ...raw }] })!.files[0]!
}

function rowsOf(result: ReturnType<typeof buildDiffRows>): DiffRow[] {
  expect(result.kind).toBe('rows')
  return result.kind === 'rows' ? result.rows : []
}

const summarize = (rows: DiffRow[]) => rows.map((row) => `${row.kind}:${row.text}`)

describe('replace 블록', () => {
  it('삭제 줄 다음에 추가 줄을 놓는다', () => {
    const file = fileOf({
      baseline: 'a\nb\nc',
      modified: 'a\nx\ny\nc',
      changeBlocks: [
        {
          kind: 'replace',
          oldRange: { startLine: 2, endLine: 2 },
          newRange: { startLine: 2, endLine: 3 },
          deletedText: 'b',
        },
      ],
    })

    expect(summarize(rowsOf(buildDiffRows(file)))).toEqual([
      'context:a',
      'del:b',
      'add:x',
      'add:y',
      'context:c',
    ])
  })

  it('deletedText 가 없으면 baseline 에서 가져온다', () => {
    const file = fileOf({
      baseline: 'a\nb\nc',
      modified: 'a\nx\nc',
      changeBlocks: [
        { kind: 'replace', oldRange: { startLine: 2, endLine: 2 }, newRange: { startLine: 2, endLine: 2 } },
      ],
    })

    expect(rowsOf(buildDiffRows(file)).find((row) => row.kind === 'del')?.text).toBe('b')
  })
})

describe('insert 블록', () => {
  it('빈 oldRange 는 삭제 줄을 만들지 않는다', () => {
    // 빈 범위 컨벤션: endLine === startLine - 1
    const file = fileOf({
      baseline: 'a\nb',
      modified: 'a\nnew\nb',
      changeBlocks: [
        { kind: 'insert', oldRange: { startLine: 2, endLine: 1 }, newRange: { startLine: 2, endLine: 2 } },
      ],
    })

    const rows = rowsOf(buildDiffRows(file))
    expect(rows.some((row) => row.kind === 'del')).toBe(false)
    expect(summarize(rows)).toEqual(['context:a', 'add:new', 'context:b'])
  })
})

describe('delete 블록', () => {
  it('빈 newRange 는 추가 줄을 만들지 않는다', () => {
    const file = fileOf({
      baseline: 'a\ngone\nb',
      modified: 'a\nb',
      changeBlocks: [
        {
          kind: 'delete',
          oldRange: { startLine: 2, endLine: 2 },
          newRange: { startLine: 2, endLine: 1 },
          deletedText: 'gone',
        },
      ],
    })

    const rows = rowsOf(buildDiffRows(file))
    expect(rows.some((row) => row.kind === 'add')).toBe(false)
    expect(summarize(rows)).toContain('del:gone')
  })
})

describe('줄 번호', () => {
  it('추가 줄에는 새 번호만, 삭제 줄에는 옛 번호만 붙는다', () => {
    const file = fileOf({
      baseline: 'a\nb',
      modified: 'a\nx',
      changeBlocks: [
        {
          kind: 'replace',
          oldRange: { startLine: 2, endLine: 2 },
          newRange: { startLine: 2, endLine: 2 },
          deletedText: 'b',
        },
      ],
    })

    const rows = rowsOf(buildDiffRows(file))
    const del = rows.find((row) => row.kind === 'del')!
    const add = rows.find((row) => row.kind === 'add')!

    expect(del.oldLine).toBe(2)
    expect(del.newLine).toBeUndefined()
    expect(add.newLine).toBe(2)
    expect(add.oldLine).toBeUndefined()
  })
})

describe('문맥과 접힘', () => {
  it('블록에서 먼 줄은 접어서 보여준다', () => {
    const baseline = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join('\n')
    const modified = baseline.replace('line20', 'CHANGED')
    const file = fileOf({
      baseline,
      modified,
      changeBlocks: [
        {
          kind: 'replace',
          oldRange: { startLine: 20, endLine: 20 },
          newRange: { startLine: 20, endLine: 20 },
          deletedText: 'line20',
        },
      ],
    })

    const rows = rowsOf(buildDiffRows(file, { context: 2 }))
    const gaps = rows.filter((row) => row.kind === 'gap')

    // 앞뒤로 접힘 표시가 하나씩
    expect(gaps).toHaveLength(2)
    expect(gaps[0]!.text).toContain('생략')
    // 문맥은 앞뒤 2줄씩
    expect(rows.filter((row) => row.kind === 'context')).toHaveLength(4)
  })

  it('파일이 짧으면 접지 않는다', () => {
    const file = fileOf({
      baseline: 'a\nb\nc',
      modified: 'a\nx\nc',
      changeBlocks: [
        {
          kind: 'replace',
          oldRange: { startLine: 2, endLine: 2 },
          newRange: { startLine: 2, endLine: 2 },
          deletedText: 'b',
        },
      ],
    })

    expect(rowsOf(buildDiffRows(file)).some((row) => row.kind === 'gap')).toBe(false)
  })
})

describe('특수 경우', () => {
  it('ref 마커면 조회가 필요하다고 알린다 — 빈 내용을 그리면 변경이 없다고 잘못 보인다', () => {
    const file = fileOf({ baseline: { ref: 'abc123' }, modified: '내용' })
    const result = buildDiffRows(file)

    expect(result.kind).toBe('needs_fetch')
    if (result.kind === 'needs_fetch') expect(result.ref).toBe('abc123')
  })

  it('삭제된 파일은 원본 전체를 삭제 줄로 보여준다', () => {
    const file = fileOf({ operation: 'delete', baseline: 'a\nb', modified: null })
    const rows = rowsOf(buildDiffRows(file))

    expect(summarize(rows)).toEqual(['del:a', 'del:b'])
  })

  it('삭제된 파일인데 원본이 없으면 못 보여준다고 알린다', () => {
    const result = buildDiffRows(fileOf({ operation: 'delete', baseline: null, modified: null }))
    expect(result.kind).toBe('unavailable')
  })

  it('새 파일은 전부 추가 줄이다', () => {
    const file = fileOf({
      operation: 'create',
      baseline: '',
      modified: 'a\nb',
      changeBlocks: [
        { kind: 'insert', oldRange: { startLine: 1, endLine: 0 }, newRange: { startLine: 1, endLine: 2 } },
      ],
    })

    expect(summarize(rowsOf(buildDiffRows(file)))).toEqual(['add:a', 'add:b'])
  })

  it('블록이 없으면 전체를 문맥으로 보여준다', () => {
    const file = fileOf({ baseline: 'a\nb', modified: 'a\nb', changeBlocks: [] })
    const rows = rowsOf(buildDiffRows(file))

    expect(rows.every((row) => row.kind === 'context')).toBe(true)
    expect(rows).toHaveLength(2)
  })

  it('내용이 아예 없으면 못 보여준다고 알린다', () => {
    const result = buildDiffRows(fileOf({ baseline: null, modified: null }))
    expect(result.kind).toBe('unavailable')
  })

  it('마지막 개행이 만드는 빈 줄은 세지 않는다', () => {
    const file = fileOf({ baseline: 'a\n', modified: 'a\n', changeBlocks: [] })
    expect(rowsOf(buildDiffRows(file))).toHaveLength(1)
  })

  it('블록이 순서 없이 와도 줄 순서대로 편다', () => {
    const file = fileOf({
      baseline: 'a\nb\nc\nd\ne',
      modified: 'a\nB\nc\nD\ne',
      changeBlocks: [
        { kind: 'replace', oldRange: { startLine: 4, endLine: 4 }, newRange: { startLine: 4, endLine: 4 }, deletedText: 'd' },
        { kind: 'replace', oldRange: { startLine: 2, endLine: 2 }, newRange: { startLine: 2, endLine: 2 }, deletedText: 'b' },
      ],
    })

    const adds = rowsOf(buildDiffRows(file)).filter((row) => row.kind === 'add')
    expect(adds.map((row) => row.text)).toEqual(['B', 'D'])
  })
})
