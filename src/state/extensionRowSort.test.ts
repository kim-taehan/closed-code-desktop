import { describe, expect, it } from 'vitest'
import { nextSort, sortRows } from './extensionRowSort'

// 열 머리를 눌러 다시 정렬하기.

describe('열 머리를 누를 때의 다음 상태', () => {
  it('처음 누르면 내림차순 — 크기·줄 수는 많은 것부터 보려고 누른다', () => {
    expect(nextSort(null, 'bytes')).toEqual({ column: 'bytes', direction: 'desc' })
  })

  it('같은 열을 다시 누르면 뒤집고, 한 번 더 누르면 푼다', () => {
    const first = nextSort(null, 'bytes')
    const second = nextSort(first, 'bytes')
    expect(second).toEqual({ column: 'bytes', direction: 'asc' })
    // 세 번째는 확장이 준 원래 순서로 — 되돌릴 방법이 없으면 한 번 누른 뒤 못 빠져나온다
    expect(nextSort(second, 'bytes')).toBeNull()
  })

  it('다른 열을 누르면 그 열의 내림차순부터 시작한다', () => {
    const bytesAsc = { column: 'bytes', direction: 'asc' as const }
    expect(nextSort(bytesAsc, 'lines')).toEqual({ column: 'lines', direction: 'desc' })
  })
})

describe('행 정렬', () => {
  const ROWS = [
    { file: 'a.ts', bytes: 9, lines: 3 },
    { file: 'b.ts', bytes: 11507, lines: 1 },
    { file: 'c.ts', bytes: 100, lines: 2 },
  ]

  it('정렬이 없으면 확장이 준 순서 그대로다', () => {
    expect(sortRows(ROWS, null)).toBe(ROWS)
  })

  it('수 칸은 수로 비교한다 — 글자로 비교하면 11507 이 9 보다 앞에 온다', () => {
    const sorted = sortRows(ROWS, { column: 'bytes', direction: 'desc' })
    expect(sorted.map((row) => row['bytes'])).toEqual([11507, 100, 9])
  })

  it('오름차순도 같은 규칙이다', () => {
    const sorted = sortRows(ROWS, { column: 'bytes', direction: 'asc' })
    expect(sorted.map((row) => row['bytes'])).toEqual([9, 100, 11507])
  })

  it('글자 칸은 글자로 비교한다', () => {
    const sorted = sortRows(ROWS, { column: 'file', direction: 'asc' })
    expect(sorted.map((row) => row['file'])).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('원본을 건드리지 않는다 — 확장이 준 순서로 되돌릴 수 있어야 한다', () => {
    sortRows(ROWS, { column: 'bytes', direction: 'asc' })
    expect(ROWS.map((row) => row['file'])).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('값이 없는 행은 방향과 무관하게 뒤로 간다', () => {
    // `lines` 를 못 센 큰 파일이 그 경우다. 0 으로 치면 "제일 작은 것" 인 척하게 되는데,
    // 못 센 것과 0 인 것은 다르다.
    const withGap = [
      { file: 'huge.bin', lines: null },
      { file: 'a.ts', lines: 5 },
      { file: 'b.ts', lines: 1 },
    ]

    expect(sortRows(withGap, { column: 'lines', direction: 'desc' }).map((row) => row['file'])).toEqual([
      'a.ts',
      'b.ts',
      'huge.bin',
    ])
    expect(sortRows(withGap, { column: 'lines', direction: 'asc' }).map((row) => row['file'])).toEqual([
      'b.ts',
      'a.ts',
      'huge.bin',
    ])
  })
})
