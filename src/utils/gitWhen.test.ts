import { describe, expect, it } from 'vitest'
import { formatGitWhen } from './gitWhen'

// git 이 두 가지 형식으로 준다는 것이 이 함수가 있는 이유다. 하나만 먹으면
// 브랜치 목록(또는 커밋 목록) 한쪽이 통째로 원문 문자열을 그리게 된다.

describe('formatGitWhen', () => {
  it('커밋의 엄격 ISO(%aI)를 읽는다', () => {
    expect(formatGitWhen('2026-07-31T14:20:33+09:00')).toBe(
      formatGitWhen(new Date('2026-07-31T14:20:33+09:00').toISOString()),
    )
    expect(formatGitWhen('2026-07-31T14:20:33+09:00')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('브랜치·임시저장의 iso8601(%ci)도 같은 모양으로 읽는다 — 공백 구분·+0900', () => {
    const spaced = formatGitWhen('2026-07-31 14:20:33 +0900')
    const strict = formatGitWhen('2026-07-31T14:20:33+09:00')

    expect(spaced).toBe(strict)
  })

  it('읽지 못하면 원문을 그대로 돌려준다 — 빈 칸을 내지 않는다', () => {
    expect(formatGitWhen('')).toBe('')
    expect(formatGitWhen('알 수 없음')).toBe('알 수 없음')
  })
})
