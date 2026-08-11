import { describe, expect, it } from 'vitest'
import { collectExtensions, filterByExtension, NO_EXTENSION, rowExtension } from './extensionRowFilter'

// 확장자로 표 좁히기. 확장자는 확장이 준 칸이 아니라 **경로에서** 뽑는다.

describe('행의 확장자', () => {
  it('경로 끝의 확장자를 점 없이 소문자로', () => {
    expect(rowExtension({ file: 'src/App.TSX' })).toBe('tsx')
    expect(rowExtension({ file: 'a/b/c.java' })).toBe('java')
  })

  it('`path` 칸도 받는다 — 행 열기와 같은 규약이다', () => {
    expect(rowExtension({ path: 'x/y.md' })).toBe('md')
  })

  it('점으로 시작하는 이름은 확장자가 아니다', () => {
    // `.gitignore` 의 확장자를 `gitignore` 로 치면 거르개에 엉뚱한 항목이 생긴다.
    expect(rowExtension({ file: '.gitignore' })).toBe(NO_EXTENSION)
    expect(rowExtension({ file: 'cfg/.env' })).toBe(NO_EXTENSION)
  })

  it('확장자가 없으면 빈 문자열', () => {
    expect(rowExtension({ file: 'Makefile' })).toBe(NO_EXTENSION)
    expect(rowExtension({ file: 'src/bin/run' })).toBe(NO_EXTENSION)
  })

  it('파일 칸이 없는 행도 터지지 않는다 — 모든 확장이 file 을 내는 것은 아니다', () => {
    expect(rowExtension({ name: 'Foo', kind: 'class' })).toBe(NO_EXTENSION)
  })

  it('마지막 점만 본다', () => {
    expect(rowExtension({ file: 'chart.min.js' })).toBe('js')
  })
})

describe('거르개에 올릴 확장자 목록', () => {
  it('중복 없이 이름순이다', () => {
    const rows = [{ file: 'b.ts' }, { file: 'a.java' }, { file: 'c.ts' }]
    expect(collectExtensions(rows)).toEqual(['java', 'ts'])
  })

  it('확장자 없는 것이 있으면 맨 뒤에 붙는다', () => {
    // 빼면 `Makefile` 만 보는 방법이 사라지는데, 화면에는 그 사실이 안 드러난다.
    const rows = [{ file: 'Makefile' }, { file: 'a.ts' }]
    expect(collectExtensions(rows)).toEqual(['ts', NO_EXTENSION])
  })

  it('확장자 없는 것이 하나도 없으면 빈 항목도 없다', () => {
    expect(collectExtensions([{ file: 'a.ts' }])).toEqual(['ts'])
  })
})

describe('확장자로 좁히기', () => {
  const ROWS = [{ file: 'a.ts' }, { file: 'b.java' }, { file: 'Makefile' }]

  it('null 이면 전부다', () => {
    expect(filterByExtension(ROWS, null)).toBe(ROWS)
  })

  it('고른 확장자만 남는다', () => {
    expect(filterByExtension(ROWS, 'ts')).toEqual([{ file: 'a.ts' }])
  })

  it('확장자 없는 것도 고를 수 있다', () => {
    expect(filterByExtension(ROWS, NO_EXTENSION)).toEqual([{ file: 'Makefile' }])
  })

  it('고른 확장자가 하나도 안 맞으면 전부를 돌려준다', () => {
    // 다시 훑어 그 확장자가 사라진 경우다. 빈 표를 보여주면 결과가 없는 것인지
    // 걸러진 것인지 화면에서 구분되지 않는다.
    expect(filterByExtension(ROWS, 'py')).toBe(ROWS)
  })
})
