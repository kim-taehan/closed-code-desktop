import { describe, expect, it } from 'vitest'
import { fuzzyMatch } from './fuzzy'

// 빠른 열기용 퍼지 검색. 서브시퀀스 매칭 + 가중치 점수.

describe('fuzzyMatch — 매칭 여부', () => {
  it('빈 쿼리는 점수 0, 위치 없음 (전부 통과)', () => {
    expect(fuzzyMatch('', 'anything.ts')).toEqual({ score: 0, positions: [] })
  })

  it('서브시퀀스면 순서대로 위치를 돌려준다 (인접하지 않아도 됨)', () => {
    const result = fuzzyMatch('ac', 'abc')
    expect(result?.positions).toEqual([0, 2])
  })

  it('서브시퀀스가 아니면 null', () => {
    expect(fuzzyMatch('xyz', 'abc')).toBeNull()
    expect(fuzzyMatch('ca', 'abc')).toBeNull() // 순서가 맞아야 한다
  })

  it('빈 타겟에 비지 않은 쿼리는 null', () => {
    expect(fuzzyMatch('a', '')).toBeNull()
  })

  it('대소문자를 무시한다', () => {
    expect(fuzzyMatch('APP', 'app.ts')?.positions).toEqual([0, 1, 2])
    expect(fuzzyMatch('app', 'APP.ts')?.positions).toEqual([0, 1, 2])
  })
})

describe('fuzzyMatch — 점수 가중치', () => {
  it('구분자 직후 매칭이 단어 중간 매칭보다 높다', () => {
    const boundary = fuzzyMatch('c', 'ab/cd')!
    const middle = fuzzyMatch('c', 'abcd')!
    expect(boundary.score).toBeGreaterThan(middle.score)
  })

  it('camelCase 경계를 보너스로 친다', () => {
    // 'A' 가 소문자 뒤 대문자 경계 → 중간 매칭보다 높다
    const camel = fuzzyMatch('a', 'bAxx')!
    const plain = fuzzyMatch('a', 'baxx')!
    expect(camel.score).toBeGreaterThan(plain.score)
  })

  it('연속 매칭이 흩어진 매칭보다 높다', () => {
    const run = fuzzyMatch('ab', 'abxx')!
    const scattered = fuzzyMatch('ab', 'axbx')!
    expect(run.positions).toEqual([0, 1])
    expect(scattered.positions).toEqual([0, 2])
    expect(run.score).toBeGreaterThan(scattered.score)
  })

  it('basename 안의 매칭을 부모 디렉토리보다 높게 친다', () => {
    // 'app' 이 basename App.tsx 에 vs 부모 경로에 흩어진 경우
    const inBasename = fuzzyMatch('app', 'src/x/App.tsx')!
    const inParent = fuzzyMatch('app', 'app/x/y.tsx')!
    expect(inBasename.score).toBeGreaterThan(inParent.score)
  })

  it('짧은 경로를 더 높게 (동점 깨기)', () => {
    const short = fuzzyMatch('a', 'a.ts')!
    const long = fuzzyMatch('a', 'a.tsxxxxxxxxxxxxx')!
    expect(short.score).toBeGreaterThan(long.score)
  })

  it('첫 히트가 빠를수록 높게 (동점 깨기 — 길이·시작위치 가중 결합)', () => {
    const early = fuzzyMatch('z', 'zaaaa')!
    const late = fuzzyMatch('z', 'aaaaz')!
    expect(early.score).toBeGreaterThan(late.score)
  })

  it('첫 글자가 경로 맨 앞이면 구분자 보너스를 받는다 (before 는 "/" 로 간주)', () => {
    // 인덱스 0 매칭은 before='/' 취급 → 보너스 포함, null 아님
    const result = fuzzyMatch('a', 'abc')
    expect(result).not.toBeNull()
    expect(result!.positions).toEqual([0])
    expect(result!.score).toBeGreaterThan(0)
  })
})
