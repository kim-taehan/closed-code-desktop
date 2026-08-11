import { describe, expect, it } from 'vitest'
import { parseTurnReview } from './parseTurnReview'

// parseTurnReview 의 파일 단위 파싱 검증 (files / changeBlocks / baseVersion / content).
// 계약: path 없는 파일 엔트리는 버리되, 나머지 파일은 살린다.
//       숫자·boolean·operation 필드는 각자 안전한 기본값으로 정규화한다.
// 최상위 게이팅·상태는 parseTurnReview.test.ts 참조.

function fileOf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { path: 'a.ts', ...overrides }
}

function firstFile(files: unknown[]) {
  return parseTurnReview({ turnId: 't', files })?.files
}

describe('files 배열', () => {
  it('배열이 아니면 빈 배열', () => {
    expect(parseTurnReview({ turnId: 't', files: 'nope' })?.files).toEqual([])
    expect(parseTurnReview({ turnId: 't' })?.files).toEqual([])
  })

  it('path 없는 엔트리는 걸러지고 유효한 것만 남는다', () => {
    const files = firstFile([{ path: 'good.ts' }, { path: '' }, { nope: 1 }, null, 42])
    expect(files).toHaveLength(1)
    expect(files?.[0]?.path).toBe('good.ts')
  })
})

describe('파일 기본값', () => {
  it('빠진 필드는 안전한 기본값으로 채운다', () => {
    const file = firstFile([{ path: 'a.ts' }])?.[0]
    expect(file).toMatchObject({
      path: 'a.ts',
      operation: 'modify',
      additions: 0,
      deletions: 0,
      openable: true,
      baseline: null,
      modified: null,
      changeBlocks: [],
    })
  })

  it('openable 은 명시적 false 일 때만 false, 그 외 값은 true', () => {
    expect(firstFile([fileOf({ openable: false })])?.[0]?.openable).toBe(false)
    expect(firstFile([fileOf({ openable: true })])?.[0]?.openable).toBe(true)
    expect(firstFile([fileOf({ openable: 'x' })])?.[0]?.openable).toBe(true)
    expect(firstFile([fileOf({})])?.[0]?.openable).toBe(true)
  })

  it('conflictReason 은 문자열일 때만 담는다', () => {
    expect(firstFile([fileOf({ conflictReason: '충돌' })])?.[0]?.conflictReason).toBe('충돌')
    expect(firstFile([fileOf({ conflictReason: 1 })])?.[0]?.conflictReason).toBeUndefined()
  })
})

describe('operation 정규화', () => {
  it('create / delete 는 그대로, 그 외는 modify', () => {
    expect(firstFile([fileOf({ operation: 'create' })])?.[0]?.operation).toBe('create')
    expect(firstFile([fileOf({ operation: 'delete' })])?.[0]?.operation).toBe('delete')
    expect(firstFile([fileOf({ operation: 'rename' })])?.[0]?.operation).toBe('modify')
    expect(firstFile([fileOf({ operation: 42 })])?.[0]?.operation).toBe('modify')
  })
})

describe('additions / deletions 숫자화', () => {
  it('유한 숫자면 그대로', () => {
    const file = firstFile([fileOf({ additions: 3, deletions: 5 })])?.[0]
    expect(file?.additions).toBe(3)
    expect(file?.deletions).toBe(5)
  })

  it('숫자가 아니거나 유한하지 않으면 0', () => {
    expect(firstFile([fileOf({ additions: '3' })])?.[0]?.additions).toBe(0)
    expect(firstFile([fileOf({ additions: NaN })])?.[0]?.additions).toBe(0)
    expect(firstFile([fileOf({ additions: Infinity })])?.[0]?.additions).toBe(0)
  })

  it('0 과 음수도 유한하면 그대로 쓴다', () => {
    expect(firstFile([fileOf({ additions: 0, deletions: -1 })])?.[0]?.deletions).toBe(-1)
  })
})

describe('baseline / modified 콘텐츠', () => {
  it('문자열이면 전문', () => {
    expect(firstFile([fileOf({ baseline: '옛 내용', modified: '새 내용' })])?.[0]?.baseline).toBe(
      '옛 내용',
    )
  })

  it('{ ref } 면 참조 마커', () => {
    const file = firstFile([fileOf({ baseline: { ref: 'blob:abc' } })])?.[0]
    expect(file?.baseline).toEqual({ ref: 'blob:abc' })
  })

  it('ref 가 문자열이 아니면 null', () => {
    expect(firstFile([fileOf({ baseline: { ref: 1 } })])?.[0]?.baseline).toBeNull()
    expect(firstFile([fileOf({ baseline: {} })])?.[0]?.baseline).toBeNull()
  })

  it('그 외 값은 null', () => {
    expect(firstFile([fileOf({ baseline: 42, modified: null })])?.[0]?.baseline).toBeNull()
    expect(firstFile([fileOf({})])?.[0]?.modified).toBeNull()
  })
})

describe('baseVersion', () => {
  it('hash 가 문자열이면 encoding/eol 기본값과 함께 담는다', () => {
    const file = firstFile([fileOf({ baseVersion: { hash: 'h1' } })])?.[0]
    expect(file?.baseVersion).toEqual({ hash: 'h1', encoding: 'utf-8', eol: '\n' })
  })

  it('encoding/eol 이 문자열이면 반영한다', () => {
    const file = firstFile([
      fileOf({ baseVersion: { hash: 'h1', encoding: 'utf-16', eol: '\r\n' } }),
    ])?.[0]
    expect(file?.baseVersion).toEqual({ hash: 'h1', encoding: 'utf-16', eol: '\r\n' })
  })

  it('encoding/eol 이 비문자열이면 기본값으로 대체된다', () => {
    const file = firstFile([fileOf({ baseVersion: { hash: 'h1', encoding: 1, eol: 2 } })])?.[0]
    expect(file?.baseVersion).toEqual({ hash: 'h1', encoding: 'utf-8', eol: '\n' })
  })

  it('hash 가 없으면 baseVersion 자체가 없다', () => {
    expect(firstFile([fileOf({ baseVersion: { encoding: 'utf-8' } })])?.[0]?.baseVersion).toBeUndefined()
  })

  it('baseVersion 이 객체가 아니면 생략된다', () => {
    expect(firstFile([fileOf({ baseVersion: 'x' })])?.[0]?.baseVersion).toBeUndefined()
    expect(firstFile([fileOf({ baseVersion: null })])?.[0]?.baseVersion).toBeUndefined()
  })
})

describe('changeBlocks', () => {
  const range = (startLine: number, endLine: number) => ({ startLine, endLine })

  it('배열이 아니면 빈 배열', () => {
    expect(firstFile([fileOf({ changeBlocks: 'x' })])?.[0]?.changeBlocks).toEqual([])
  })

  it('유효한 블록을 담는다 (insert/delete/replace)', () => {
    const file = firstFile([
      fileOf({
        changeBlocks: [
          { kind: 'insert', oldRange: range(2, 1), newRange: range(2, 3) },
          { kind: 'replace', oldRange: range(5, 6), newRange: range(5, 6), deletedText: '옛줄' },
        ],
      }),
    ])?.[0]
    expect(file?.changeBlocks).toHaveLength(2)
    expect(file?.changeBlocks?.[1]?.deletedText).toBe('옛줄')
  })

  it('모르는 kind 는 걸러진다', () => {
    const blocks = firstFile([
      fileOf({ changeBlocks: [{ kind: 'swap', oldRange: range(1, 1), newRange: range(1, 1) }] }),
    ])?.[0]?.changeBlocks
    expect(blocks).toEqual([])
  })

  it('range 가 없거나 숫자가 아니면 블록이 걸러진다', () => {
    const blocks = firstFile([
      fileOf({
        changeBlocks: [
          { kind: 'insert', newRange: range(1, 1) },
          { kind: 'insert', oldRange: range(1, 1), newRange: { startLine: 'a', endLine: 1 } },
          { kind: 'delete', oldRange: null, newRange: range(1, 1) },
        ],
      }),
    ])?.[0]?.changeBlocks
    expect(blocks).toEqual([])
  })

  it('deletedText 가 문자열이 아니면 생략된다', () => {
    const block = firstFile([
      fileOf({
        changeBlocks: [{ kind: 'delete', oldRange: range(1, 1), newRange: range(1, 0), deletedText: 9 }],
      }),
    ])?.[0]?.changeBlocks?.[0]
    expect(block?.deletedText).toBeUndefined()
  })

  it('블록 요소가 객체가 아니면 걸러진다', () => {
    expect(firstFile([fileOf({ changeBlocks: [null, 42, 'x'] })])?.[0]?.changeBlocks).toEqual([])
  })
})
