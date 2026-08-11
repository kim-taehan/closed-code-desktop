import { describe, expect, it } from 'vitest'
import { parseTurnReview } from './parseTurnReview'
import { TurnReviewStatus } from './turnReview'

// parseTurnReview 는 신뢰할 수 없는 turn_changes 페이로드를 도메인 모델로 좁힌다.
// 계약: 모르는 상태·빠진 필드를 조용히 버리지 않고 **안전한 기본값**으로 채운다
//       (예: 모르는 상태 → 진행 중, 그래야 결정 버튼을 잘못 열지 않는다).
// turnId 가 없으면 붙일 턴을 모르므로 전체를 null 로 버린다.
// 이 파일은 최상위 파싱(게이팅·상태·래퍼·actions·verification)을 다룬다.
// 파일 단위 파싱은 parseTurnReview.more.test.ts 참조.

describe('입력 게이팅', () => {
  it('null 이면 null', () => {
    expect(parseTurnReview(null)).toBeNull()
  })

  it('객체가 아니면 null', () => {
    expect(parseTurnReview('문자열')).toBeNull()
    expect(parseTurnReview(42)).toBeNull()
    expect(parseTurnReview(true)).toBeNull()
    expect(parseTurnReview(undefined)).toBeNull()
  })

  it('turnId 가 없으면 null', () => {
    expect(parseTurnReview({ status: 'ACCEPTED' })).toBeNull()
  })

  it('turnId 가 문자열이 아니면 null', () => {
    expect(parseTurnReview({ turnId: 123 })).toBeNull()
  })

  it('turnId 가 빈 문자열이면 null', () => {
    expect(parseTurnReview({ turnId: '' })).toBeNull()
  })
})

describe('review 래퍼', () => {
  it('{ review: {...} } 로 감싸 와도 안을 읽는다', () => {
    const parsed = parseTurnReview({ review: { turnId: 't1', status: 'ACCEPTED' } })
    expect(parsed?.turnId).toBe('t1')
    expect(parsed?.status).toBe(TurnReviewStatus.ACCEPTED)
  })

  it('래퍼가 없으면 record 자체를 소스로 쓴다', () => {
    const parsed = parseTurnReview({ turnId: 't2', status: 'REJECTED' })
    expect(parsed?.turnId).toBe('t2')
    expect(parsed?.status).toBe(TurnReviewStatus.REJECTED)
  })

  it('review 가 있으면 최상위 turnId 는 무시된다', () => {
    const parsed = parseTurnReview({ turnId: 'outer', review: { turnId: 'inner' } })
    expect(parsed?.turnId).toBe('inner')
  })
})

describe('상태 파싱', () => {
  it('알려진 상태는 그대로 매핑된다', () => {
    for (const key of Object.keys(TurnReviewStatus)) {
      const parsed = parseTurnReview({ turnId: 't', status: key })
      expect(parsed?.status).toBe(key)
    }
  })

  it('모르는 상태는 진행 중으로 본다 (버튼 오작동 방지)', () => {
    const parsed = parseTurnReview({ turnId: 't', status: 'WHO_KNOWS' })
    expect(parsed?.status).toBe(TurnReviewStatus.IN_PROGRESS)
  })

  it('상태가 문자열이 아니면 진행 중', () => {
    expect(parseTurnReview({ turnId: 't', status: 99 })?.status).toBe(TurnReviewStatus.IN_PROGRESS)
    expect(parseTurnReview({ turnId: 't' })?.status).toBe(TurnReviewStatus.IN_PROGRESS)
  })

  it('Object.prototype 키(toString·constructor 등)도 안전하게 IN_PROGRESS 로 떨어진다', () => {
    // 과거 회귀: parseStatus 가 Object.hasOwn 가드 없이 bracket 조회를 해
    //   'toString'/'valueOf'/'constructor' 가 상속 함수로 잡혀 폴백을 우회했다.
    //   이제 프로토타입 키는 열거값이 아니므로 IN_PROGRESS 로 본다.
    for (const key of ['toString', 'valueOf', 'constructor', 'hasOwnProperty']) {
      const parsed = parseTurnReview({ turnId: 't', status: key })
      expect(parsed?.status).toBe(TurnReviewStatus.IN_PROGRESS)
    }
  })
})

describe('선택 필드', () => {
  it('chatTurnId 가 문자열이면 담는다', () => {
    expect(parseTurnReview({ turnId: 't', chatTurnId: 'c1' })?.chatTurnId).toBe('c1')
  })

  it('chatTurnId 가 문자열이 아니면 생략된다', () => {
    expect(parseTurnReview({ turnId: 't', chatTurnId: 5 })?.chatTurnId).toBeUndefined()
  })

  it('isFinalized 가 boolean 이면 담는다', () => {
    expect(parseTurnReview({ turnId: 't', isFinalized: true })?.isFinalized).toBe(true)
    expect(parseTurnReview({ turnId: 't', isFinalized: false })?.isFinalized).toBe(false)
  })

  it('isFinalized 가 boolean 이 아니면 생략된다 (잠정 상태로 남는다)', () => {
    expect(parseTurnReview({ turnId: 't', isFinalized: 'yes' })?.isFinalized).toBeUndefined()
    expect(parseTurnReview({ turnId: 't' })?.isFinalized).toBeUndefined()
  })
})

describe('actions', () => {
  it('문자열 배열이면 그대로 담는다', () => {
    const parsed = parseTurnReview({ turnId: 't', actions: ['accept_current', 'mark_resolved'] })
    expect(parsed?.actions).toEqual(['accept_current', 'mark_resolved'])
  })

  it('배열 안 비문자열은 걸러진다', () => {
    const parsed = parseTurnReview({ turnId: 't', actions: ['ok', 1, null, {}, 'go'] })
    expect(parsed?.actions).toEqual(['ok', 'go'])
  })

  it('배열이 아니면 actions 필드 자체가 없다', () => {
    expect(parseTurnReview({ turnId: 't', actions: 'nope' })?.actions).toBeUndefined()
    expect(parseTurnReview({ turnId: 't' })?.actions).toBeUndefined()
  })

  it('빈 배열은 빈 배열로 담긴다', () => {
    expect(parseTurnReview({ turnId: 't', actions: [] })?.actions).toEqual([])
  })
})

describe('verification', () => {
  it('유효한 status 만 있으면 그것만 담는다', () => {
    const parsed = parseTurnReview({ turnId: 't', verification: { status: 'verified' } })
    expect(parsed?.verification).toEqual({ status: 'verified' })
  })

  it('세 가지 status 를 모두 받는다', () => {
    for (const status of ['verified', 'unverified', 'not_required']) {
      const parsed = parseTurnReview({ turnId: 't', verification: { status } })
      expect(parsed?.verification?.status).toBe(status)
    }
  })

  it('모르는 status 면 verification 자체가 없다', () => {
    expect(
      parseTurnReview({ turnId: 't', verification: { status: 'maybe' } })?.verification,
    ).toBeUndefined()
  })

  it('reason 과 commands 를 담는다', () => {
    const parsed = parseTurnReview({
      turnId: 't',
      verification: { status: 'unverified', reason: '테스트 실패', commands: ['npm test', 7] },
    })
    expect(parsed?.verification?.reason).toBe('테스트 실패')
    expect(parsed?.verification?.commands).toEqual(['npm test'])
  })

  it('verification 이 객체가 아니면 생략된다', () => {
    expect(parseTurnReview({ turnId: 't', verification: 'x' })?.verification).toBeUndefined()
    expect(parseTurnReview({ turnId: 't', verification: null })?.verification).toBeUndefined()
  })

  it('commands 가 배열이 아니면 commands 는 생략된다', () => {
    const parsed = parseTurnReview({
      turnId: 't',
      verification: { status: 'verified', commands: 'npm test' },
    })
    expect(parsed?.verification?.commands).toBeUndefined()
  })
})
