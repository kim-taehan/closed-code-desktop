import { describe, expect, it } from 'vitest'
import { parseGlob } from './globFilter'

describe('parseGlob — 지원 문법', () => {
  it('`**/` 접두사가 재귀 여부를 정한다', () => {
    expect(parseGlob('**/*.ts').recursive).toBe(true)
    expect(parseGlob('*.ts').recursive).toBe(false)
  })

  it('중괄호 목록의 확장자를 전부 받는다 (TODO 수집기가 쓰는 모양)', () => {
    const filter = parseGlob('**/*.{ts,tsx,js,jsx,py,java,kt,go,rs,rb,c,h,cpp,cs,swift,sh,md}')
    for (const name of ['a.ts', 'a.tsx', 'a.py', 'a.md', 'a.swift']) {
      expect(filter.matches(name)).toBe(true)
    }
    expect(filter.matches('a.txt')).toBe(false)
    expect(filter.matches('README')).toBe(false)
  })

  it('확장자 하나짜리도 받는다', () => {
    const filter = parseGlob('**/*.ts')
    expect(filter.matches('a.ts')).toBe(true)
    expect(filter.matches('a.tsx')).toBe(false)
  })

  it('`*` 는 전부 받는다', () => {
    expect(parseGlob('**/*').matches('LICENSE')).toBe(true)
    expect(parseGlob('*').matches('a.ts')).toBe(true)
  })

  it('대소문자를 무시한다 — .TS 로 저장된 레거시 소스가 있다', () => {
    expect(parseGlob('**/*.java').matches('Main.JAVA')).toBe(true)
  })

  it('공백이 섞인 목록도 받는다', () => {
    expect(parseGlob('**/*.{ts, tsx}').matches('a.tsx')).toBe(true)
  })

  it('확장자가 접미사로만 걸린다 — 이름 안에 들어 있으면 아니다', () => {
    expect(parseGlob('**/*.ts').matches('ts.md')).toBe(false)
    expect(parseGlob('**/*.ts').matches('a.ts.bak')).toBe(false)
  })
})

describe('parseGlob — 모르는 문법은 던진다', () => {
  // 조용히 빈 배열을 주면 확장 개발자가 "파일이 없다" 로 오해한다.
  // 지원 범위를 넓히더라도 **모르는 모양을 통과시키는 방향으로는 완화하지 않는다.**
  it.each([
    ['src/**/*.ts', '경로 중간 패턴'],
    ['**/*.?s', '문자 하나 와일드카드'],
    ['**/test-*.ts', '접두사 패턴'],
    ['**/*.{ts,}', '빈 항목'],
    ['**/*.{}', '빈 목록'],
    ['**/*.', '확장자 없음'],
    ['', '빈 문자열'],
    ['**/*.{ts,*}', '목록 안의 와일드카드'],
  ])('%s (%s)', (glob) => {
    expect(() => parseGlob(glob)).toThrow(/지원하지 않는 glob/)
  })
})
