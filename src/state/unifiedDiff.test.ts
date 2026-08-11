import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff, rowsFromContent } from './unifiedDiff'

// parseUnifiedDiff 는 git 이 준 unified diff 텍스트를 DiffRow[] 로 편다.
// 계약: 줄 번호의 유일한 근거는 hunk 헤더다 — 세어서 맞추지 않는다.
//       hunk 앞의 헤더(diff --git/---/+++)와 `\ No newline` 메타 줄은 줄 번호에 영향을 주지 않아야 한다.
//       메타 줄에서 줄 번호가 어긋나면 diff 뷰 전체가 밀린다.

describe('hunk 헤더 이전', () => {
  it('첫 hunk 앞의 헤더 줄은 모두 무시된다', () => {
    const diff = ['diff --git a/f b/f', 'index 111..222 100644', '--- a/f', '+++ b/f'].join('\n')
    expect(parseUnifiedDiff(diff)).toEqual([])
  })

  it('hunk 가 아예 없으면 빈 배열', () => {
    expect(parseUnifiedDiff('그냥 텍스트\n두 번째 줄')).toEqual([])
  })

  it('빈 문자열이면 빈 배열', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })
})

describe('hunk 헤더가 줄 번호를 잡는다', () => {
  it('추가·삭제·문맥의 줄 번호를 헤더에서 시작한다', () => {
    const diff = ['@@ -10,3 +20,3 @@', ' 문맥', '-옛것', '+새것'].join('\n')
    expect(parseUnifiedDiff(diff)).toEqual([
      { kind: 'context', oldLine: 10, newLine: 20, text: '문맥' },
      { kind: 'del', oldLine: 11, text: '옛것' },
      { kind: 'add', newLine: 21, text: '새것' },
    ])
  })

  it('count 가 생략된 헤더(@@ -5 +7 @@)도 시작 줄만으로 잡는다', () => {
    const diff = ['@@ -5 +7 @@', ' ctx'].join('\n')
    expect(parseUnifiedDiff(diff)).toEqual([{ kind: 'context', oldLine: 5, newLine: 7, text: 'ctx' }])
  })

  it('문맥은 old·new 둘 다, 추가는 new 만, 삭제는 old 만 올린다', () => {
    const diff = ['@@ -1,2 +1,3 @@', ' a', '+b', '+c', ' d'].join('\n')
    expect(parseUnifiedDiff(diff)).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'a' },
      { kind: 'add', newLine: 2, text: 'b' },
      { kind: 'add', newLine: 3, text: 'c' },
      { kind: 'context', oldLine: 2, newLine: 4, text: 'd' },
    ])
  })
})

describe('여러 hunk 사이 gap', () => {
  it('두 번째 hunk 앞에 gap 행을 넣는다', () => {
    const diff = ['@@ -1,1 +1,1 @@', '+a', '@@ -10,1 +10,1 @@', '+b'].join('\n')
    const rows = parseUnifiedDiff(diff)
    expect(rows).toEqual([
      { kind: 'add', newLine: 1, text: 'a' },
      { kind: 'gap', text: '' },
      { kind: 'add', newLine: 10, text: 'b' },
    ])
  })

  it('첫 hunk 앞에는 gap 을 넣지 않는다', () => {
    const rows = parseUnifiedDiff(['@@ -1,1 +1,1 @@', '+a'].join('\n'))
    expect(rows.some((r) => r.kind === 'gap')).toBe(false)
  })
})

describe('메타 줄은 줄 번호를 건드리지 않는다', () => {
  it('`\\ No newline at end of file` 은 무시되고 이후 줄 번호가 안 밀린다', () => {
    const diff = ['@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+b'].join('\n')
    expect(parseUnifiedDiff(diff)).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'a' },
      { kind: 'del', oldLine: 2, text: 'b' },
      { kind: 'add', newLine: 2, text: 'b' },
    ])
  })
})

describe('본문 마커 처리', () => {
  it('맨 끝의 빈 줄은 건너뛴다', () => {
    const diff = ['@@ -1,1 +1,1 @@', '+a', ''].join('\n')
    expect(parseUnifiedDiff(diff)).toEqual([{ kind: 'add', newLine: 1, text: 'a' }])
  })

  it('빈 문맥 줄은 한 칸짜리 스페이스 마커로 온다', () => {
    const diff = ['@@ -1,1 +1,1 @@', ' '].join('\n')
    expect(parseUnifiedDiff(diff)).toEqual([{ kind: 'context', oldLine: 1, newLine: 1, text: '' }])
  })

  it('인식 못하는 마커로 시작하는 줄은 무시하고 줄 번호도 안 올린다', () => {
    const diff = ['@@ -1,1 +2,1 @@', '?이상한줄', ' 문맥'].join('\n')
    expect(parseUnifiedDiff(diff)).toEqual([
      { kind: 'context', oldLine: 1, newLine: 2, text: '문맥' },
    ])
  })

  it('마커 뒤 본문의 선행 공백을 보존한다', () => {
    const diff = ['@@ -1,1 +1,1 @@', '+  들여쓴 줄'].join('\n')
    expect(parseUnifiedDiff(diff)).toEqual([{ kind: 'add', newLine: 1, text: '  들여쓴 줄' }])
  })
})

describe('rowsFromContent — 비교 대상 없는 파일', () => {
  it('모든 줄을 add 로, 1부터 번호를 매긴다', () => {
    expect(rowsFromContent('첫줄\n둘째줄')).toEqual([
      { kind: 'add', newLine: 1, text: '첫줄' },
      { kind: 'add', newLine: 2, text: '둘째줄' },
    ])
  })

  it('빈 문자열도 한 줄(빈 줄)로 낸다', () => {
    expect(rowsFromContent('')).toEqual([{ kind: 'add', newLine: 1, text: '' }])
  })

  it('끝의 개행은 빈 마지막 줄을 만든다 (split 결과 그대로)', () => {
    expect(rowsFromContent('a\n')).toEqual([
      { kind: 'add', newLine: 1, text: 'a' },
      { kind: 'add', newLine: 2, text: '' },
    ])
  })
})
