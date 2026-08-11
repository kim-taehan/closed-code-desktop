import { describe, expect, it } from 'vitest'
import { parseTurnReview } from './parseTurnReview'
import {
  TurnReviewStatus,
  isContentRef,
  isEmptyRange,
  isFinalState,
  isProvisional,
  needsManualResolution,
  rangeLineCount,
  routableActions,
  totalChanges,
} from './turnReview'

// ADR-038 §5 구조화 리뷰 계약.
// 런타임이 계산해 준 범위를 그대로 소비한다 — diff 를 다시 계산하지 않는다.

const FILE = {
  path: 'src/app.ts',
  operation: 'modify',
  additions: 3,
  deletions: 1,
  openable: true,
  baseline: 'a\nb\nc',
  modified: 'a\nx\ny\nz\nc',
  changeBlocks: [
    { kind: 'replace', oldRange: { startLine: 2, endLine: 2 }, newRange: { startLine: 2, endLine: 4 }, deletedText: 'b' },
  ],
}

describe('빈 범위 컨벤션', () => {
  it('endLine === startLine - 1 이면 빈 범위다', () => {
    expect(isEmptyRange({ startLine: 3, endLine: 2 })).toBe(true)
    expect(isEmptyRange({ startLine: 3, endLine: 3 })).toBe(false)
  })

  it('빈 범위의 줄 수는 0 이다', () => {
    expect(rangeLineCount({ startLine: 3, endLine: 2 })).toBe(0)
    expect(rangeLineCount({ startLine: 2, endLine: 4 })).toBe(3)
    expect(rangeLineCount({ startLine: 5, endLine: 5 })).toBe(1)
  })
})

describe('파싱', () => {
  it('턴 리뷰를 읽는다', () => {
    const review = parseTurnReview({
      turnId: 't1',
      chatTurnId: 'chat-t1',
      status: 'PENDING_DECISION',
      isFinalized: false,
      files: [FILE],
    })

    expect(review).toMatchObject({
      turnId: 't1',
      chatTurnId: 'chat-t1',
      status: TurnReviewStatus.PENDING_DECISION,
      isFinalized: false,
    })
    expect(review!.files).toHaveLength(1)
    expect(review!.files[0]!.changeBlocks[0]!.kind).toBe('replace')
  })

  it('review 로 감싸 와도 읽는다', () => {
    const review = parseTurnReview({ review: { turnId: 't1', status: 'ACCEPTED', files: [] } })
    expect(review?.turnId).toBe('t1')
  })

  it('turnId 가 없으면 버린다 — 어느 턴 것인지 모르면 붙일 수 없다', () => {
    expect(parseTurnReview({ status: 'ACCEPTED', files: [] })).toBeNull()
    expect(parseTurnReview(null)).toBeNull()
  })

  it('모르는 상태는 진행 중으로 본다 — 버튼을 잘못 열어주지 않는다', () => {
    const review = parseTurnReview({ turnId: 't1', status: '이상한상태', files: [] })
    expect(review!.status).toBe(TurnReviewStatus.IN_PROGRESS)
  })

  it('files 가 없거나 깨져도 빈 배열이다', () => {
    expect(parseTurnReview({ turnId: 't1', files: 'x' })!.files).toEqual([])
    expect(parseTurnReview({ turnId: 't1' })!.files).toEqual([])
  })

  it('path 가 없는 파일 항목은 버린다', () => {
    const review = parseTurnReview({ turnId: 't1', files: [{ operation: 'modify' }, FILE] })
    expect(review!.files).toHaveLength(1)
  })

  it('operation 이 이상하면 modify 로 본다', () => {
    const review = parseTurnReview({ turnId: 't1', files: [{ path: 'a.ts', operation: 'rename' }] })
    expect(review!.files[0]!.operation).toBe('modify')
  })

  it('ref 마커를 전문과 구분한다', () => {
    const review = parseTurnReview({
      turnId: 't1',
      files: [{ path: 'big.ts', baseline: { ref: 'abc123' }, modified: '내용' }],
    })

    expect(isContentRef(review!.files[0]!.baseline)).toBe(true)
    expect(isContentRef(review!.files[0]!.modified)).toBe(false)
  })

  it('delete 는 modified 가 없다', () => {
    const review = parseTurnReview({
      turnId: 't1',
      files: [{ path: 'gone.ts', operation: 'delete', baseline: '내용', modified: null }],
    })
    expect(review!.files[0]!.modified).toBeNull()
  })

  it('깨진 changeBlock 은 버리고 나머지는 살린다', () => {
    const review = parseTurnReview({
      turnId: 't1',
      files: [
        {
          path: 'a.ts',
          changeBlocks: [
            { kind: '이상함', oldRange: { startLine: 1, endLine: 1 }, newRange: { startLine: 1, endLine: 1 } },
            { kind: 'insert', oldRange: { startLine: 2, endLine: 1 }, newRange: { startLine: 2, endLine: 3 } },
            { kind: 'delete' },
          ],
        },
      ],
    })

    expect(review!.files[0]!.changeBlocks).toHaveLength(1)
    expect(review!.files[0]!.changeBlocks[0]!.kind).toBe('insert')
  })

  it('baseVersion 을 읽고 빠진 값은 기본값으로 채운다', () => {
    const review = parseTurnReview({
      turnId: 't1',
      files: [{ path: 'a.ts', baseVersion: { hash: 'h1' } }],
    })

    expect(review!.files[0]!.baseVersion).toEqual({ hash: 'h1', encoding: 'utf-8', eol: '\n' })
  })

  it('검증 정보를 읽는다', () => {
    const review = parseTurnReview({
      turnId: 't1',
      files: [],
      verification: { status: 'unverified', reason: '테스트 미실행' },
    })

    expect(review!.verification).toEqual({ status: 'unverified', reason: '테스트 미실행' })
  })

  it('모르는 검증 상태는 무시한다', () => {
    const review = parseTurnReview({ turnId: 't1', files: [], verification: { status: '???' } })
    expect(review!.verification).toBeUndefined()
  })
})

describe('상태 판정', () => {
  const base = { turnId: 't1', files: [] }

  it('isFinalized 없는 ACCEPTED 는 잠정이다 — 사용자가 뒤집을 수 있다', () => {
    const review = parseTurnReview({ ...base, status: 'ACCEPTED' })!
    expect(isProvisional(review)).toBe(true)
    expect(isFinalState(review)).toBe(false)
  })

  it('isFinalized 가 true 면 확정이다', () => {
    const review = parseTurnReview({ ...base, status: 'ACCEPTED', isFinalized: true })!
    expect(isProvisional(review)).toBe(false)
    expect(isFinalState(review)).toBe(true)
  })

  it('결정 대기는 잠정이 아니다 — 아직 고르지 않았다', () => {
    const review = parseTurnReview({ ...base, status: 'PENDING_DECISION' })!
    expect(isProvisional(review)).toBe(false)
  })

  it('FAILED 와 RESOLVED_MANUALLY 는 최종이다', () => {
    expect(isFinalState(parseTurnReview({ ...base, status: 'FAILED' })!)).toBe(true)
    expect(isFinalState(parseTurnReview({ ...base, status: 'RESOLVED_MANUALLY' })!)).toBe(true)
  })
})

describe('합계', () => {
  it('파일별 증감을 더한다', () => {
    const review = parseTurnReview({
      turnId: 't1',
      files: [FILE, { path: 'b.ts', additions: 10, deletions: 2 }],
    })!

    expect(totalChanges(review)).toEqual({ additions: 13, deletions: 3 })
  })

  it('파일이 없으면 0 이다', () => {
    expect(totalChanges(parseTurnReview({ turnId: 't1', files: [] })!)).toEqual({
      additions: 0,
      deletions: 0,
    })
  })
})

// ── 허용 액션 (DC-1214) ────────────────────────────────

function withActions(actions?: string[]) {
  return parseTurnReview({
    turnId: 't1',
    files: [],
    ...(actions ? { actions } : {}),
  })!
}

describe('routableActions', () => {
  it('런타임이 준 목록에서 보낼 수 있는 것만 남긴다', () => {
    expect(routableActions(withActions(['accept', 'reject']))).toEqual(['accept', 'reject'])
  })

  it('accept_current·mark_resolved 는 보낼 곳이 없어 빠진다', () => {
    expect(routableActions(withActions(['accept_current', 'reject']))).toEqual(['reject'])
    expect(routableActions(withActions(['accept_current', 'mark_resolved']))).toEqual([])
    expect(routableActions(withActions(['mark_resolved']))).toEqual([])
  })

  it('빈 목록이면 아무 판정도 낼 수 없다 — 이력 재생본이 그렇다', () => {
    expect(routableActions(withActions([]))).toEqual([])
  })

  it('목록 자체가 없으면(구버전 런타임) 종전 동작으로 폴백한다', () => {
    expect(routableActions(withActions())).toEqual(['accept', 'reject'])
  })

  it('모르는 액션 이름은 조용히 버린다', () => {
    expect(routableActions(withActions(['accept', 'teleport']))).toEqual(['accept'])
  })
})

describe('needsManualResolution', () => {
  it('보낼 수 없는 액션이 섞여 있으면 사람이 정리해야 한다', () => {
    expect(needsManualResolution(withActions(['accept_current', 'reject']))).toBe(true)
    expect(needsManualResolution(withActions(['mark_resolved']))).toBe(true)
  })

  it('평범한 판정만 남았으면 안내가 필요 없다', () => {
    expect(needsManualResolution(withActions(['accept', 'reject']))).toBe(false)
    expect(needsManualResolution(withActions([]))).toBe(false)
    expect(needsManualResolution(withActions())).toBe(false)
  })
})
