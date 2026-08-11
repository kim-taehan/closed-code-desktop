import { describe, expect, it } from 'vitest'
import { rowOpenTarget } from './extensionRowTarget'

// 이 규칙이 확장 개발자와의 계약이다 — 바꾸면 이미 쓰던 확장의 행이 안 열린다.

describe('확장 결과 행의 열기 대상', () => {
  it('file 칸을 경로로 읽는다', () => {
    expect(rowOpenTarget({ file: 'src/App.tsx', text: 'TODO' })).toEqual({ path: 'src/App.tsx' })
  })

  it('file 이 없으면 path 를 쓴다', () => {
    expect(rowOpenTarget({ path: 'src/main.ts' })).toEqual({ path: 'src/main.ts' })
  })

  it('file 이 path 를 이긴다', () => {
    expect(rowOpenTarget({ path: '뒤', file: '앞' })).toEqual({ path: '앞' })
  })

  it('line 을 함께 읽는다', () => {
    expect(rowOpenTarget({ file: 'a.ts', line: 12 })).toEqual({ path: 'a.ts', line: 12 })
  })

  it('문자열로 온 line 도 받는다 — 리포트를 파싱한 확장이 흔히 그렇게 넘긴다', () => {
    expect(rowOpenTarget({ file: 'a.ts', line: '12' })).toEqual({ path: 'a.ts', line: 12 })
  })

  it('열 수 없는 행은 null 이다', () => {
    expect(rowOpenTarget({})).toBeNull()
    expect(rowOpenTarget({ text: 'TODO' })).toBeNull()
    expect(rowOpenTarget({ file: '' })).toBeNull()
    expect(rowOpenTarget({ file: '   ' })).toBeNull()
    expect(rowOpenTarget({ file: 42 })).toBeNull()
  })

  it('1-based 를 벗어난 줄 번호는 버린다 — 0 을 넘기면 엉뚱한 줄로 간다', () => {
    // 경로는 살아 있어야 한다. 줄이 이상하다고 파일까지 못 열면 손해가 더 크다.
    for (const line of [0, -3, 1.5, Number.NaN, '열두째', null, {}]) {
      expect(rowOpenTarget({ file: 'a.ts', line })).toEqual({ path: 'a.ts' })
    }
  })
})
