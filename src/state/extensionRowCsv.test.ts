import { describe, expect, it } from 'vitest'
import { csvFileName, rowsToCsv } from './extensionRowCsv'

// 확장 결과 표 → CSV 글자.

describe('CSV 만들기', () => {
  it('첫 줄이 열 이름이고 줄 끝은 CRLF 다', () => {
    // RFC 4180 이고 Excel 이 그 기준으로 읽는다. LF 만 쓰면 Windows 판에서 줄이 안 갈린다.
    const csv = rowsToCsv([{ file: 'a.ts', lines: 3 }])

    expect(csv).toBe('file,lines\r\na.ts,3\r\n')
  })

  it('열은 첫 행의 키 순서다 — 표와 같은 규칙을 쓴다', () => {
    const csv = rowsToCsv([{ b: 1, a: 2 }])

    expect(csv.split('\r\n')[0]).toBe('b,a')
  })

  it('뒤쪽 행에만 있는 키도 열이 된다 — 버리면 데이터를 조용히 숨기는 것이 된다', () => {
    const csv = rowsToCsv([{ a: 1 }, { a: 2, b: 3 }])

    expect(csv.split('\r\n')).toEqual(['a,b', '1,', '2,3', ''])
  })

  it('쉼표·따옴표·줄바꿈이 있으면 감싼다', () => {
    // 안 감싸면 그 행부터 칸이 통째로 밀린다. 경로에 쉼표가 든 파일은 실제로 있다.
    const csv = rowsToCsv([{ file: 'a,b.ts', note: 'he said "hi"', body: '두\n줄' }])

    expect(csv.split('\r\n')[1]).toBe('"a,b.ts","he said ""hi""","두\n줄"')
  })

  it('수식으로 시작하는 값은 앞에 작은따옴표를 붙인다', () => {
    // Excel 이 `=`·`+`·`-`·`@` 로 시작하는 칸을 **수식으로 실행**한다 (CSV injection).
    // 파일 경로가 `-` 로 시작하는 것은 드물지 않고, 여는 쪽은 우리가 아니다.
    const csv = rowsToCsv([{ a: '=1+1', b: '-rf', c: '@x', d: '+n' }])

    expect(csv.split('\r\n')[1]).toBe("'=1+1,'-rf,'@x,'+n")
  })

  it('빈 값과 없는 값은 빈 칸이다', () => {
    const csv = rowsToCsv([{ a: null, b: undefined, c: '' }])

    expect(csv.split('\r\n')[1]).toBe(',,')
  })

  it('행이 없으면 빈 문자열이다 — 머리글만 있는 파일을 만들지 않는다', () => {
    // "내보내기가 됐는데 내용이 없다" 와 "내보낼 것이 없다" 가 파일 안에서 구분되지 않는다.
    expect(rowsToCsv([])).toBe('')
  })
})

describe('저장 대화상자에 채울 이름', () => {
  it('뷰 제목에 .csv 를 붙인다 — 띄어쓰기는 남긴다', () => {
    expect(csvFileName('샘플 확장')).toBe('샘플 확장.csv')
  })

  it('파일 이름에 못 쓰는 문자를 뺀다', () => {
    // 매니페스트의 제목은 사람이 손으로 쓴 값이라 무엇이든 올 수 있다.
    expect(csvFileName('a/b:c*?"<>|d')).toBe('abcd.csv')
  })

  it('뺀 뒤에 남는 것이 없으면 기본 이름을 쓴다', () => {
    expect(csvFileName('///')).toBe('확장 결과.csv')
  })
})
