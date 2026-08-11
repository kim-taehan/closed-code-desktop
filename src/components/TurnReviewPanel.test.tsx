// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { parseTurnReview } from '../../shared/protocol/parseTurnReview'
import { STATUS_LABEL, TurnReviewStatus, type TurnReview } from '../../shared/protocol/turnReview'
import { TurnReviewPanel } from './TurnReviewPanel'

// 턴 리뷰 카드. 런타임이 이미 파일을 썼고, 이 카드는 유지/복원을 정한다.

afterEach(cleanup)

function review(overrides: Record<string, unknown> = {}): TurnReview {
  return parseTurnReview({
    turnId: 'turn-1',
    chatTurnId: 'chat-1',
    status: 'PENDING_DECISION',
    files: [
      { path: 'src/a.ts', operation: 'modify', additions: 3, deletions: 1 },
      { path: 'src/new.ts', operation: 'create', additions: 10, deletions: 0 },
    ],
    ...overrides,
  })!
}

describe('기본 표시', () => {
  it('제목과 파일 목록을 보여준다', () => {
    render(<TurnReviewPanel review={review()} onDecide={() => {}} />)

    expect(screen.getByText('변경 사항')).toBeTruthy()
    expect(screen.getByText('src/a.ts')).toBeTruthy()
    expect(screen.getByText('src/new.ts')).toBeTruthy()
  })

  it('증감 합계를 보여준다', () => {
    const { container } = render(<TurnReviewPanel review={review()} onDecide={() => {}} />)
    const totals = container.querySelector('.turn-review-totals')!

    expect(totals.textContent).toContain('+13')
    expect(totals.textContent).toContain('−1')
  })

  it('연산 표시가 파일마다 붙는다', () => {
    const { container } = render(<TurnReviewPanel review={review()} onDecide={() => {}} />)
    const marks = [...container.querySelectorAll('.turn-review-op')].map((el) => el.textContent)

    expect(marks).toEqual(['M', 'C'])
  })
})

describe('상태 배지', () => {
  const cases: TurnReviewStatus[] = [
    TurnReviewStatus.IN_PROGRESS,
    TurnReviewStatus.PENDING_DECISION,
    TurnReviewStatus.ACCEPTING,
    TurnReviewStatus.ACCEPTED,
    TurnReviewStatus.REJECTED,
    TurnReviewStatus.ACCEPT_CONFLICT,
    TurnReviewStatus.FAILED,
  ]

  for (const status of cases) {
    it(`${status} 배지가 뜬다`, () => {
      render(<TurnReviewPanel review={review({ status })} onDecide={() => {}} />)
      expect(screen.getByText(STATUS_LABEL[status])).toBeTruthy()
    })
  }
})

describe('잠정 상태', () => {
  it('isFinalized 없는 ACCEPTED 는 점선 테두리로 표시하고 뒤집을 수 있다', () => {
    const { container } = render(
      <TurnReviewPanel review={review({ status: 'ACCEPTED' })} onDecide={() => {}} />,
    )

    expect(container.querySelector('.turn-review--provisional')).toBeTruthy()
    // 두 버튼이 모두 남아 있어야 뒤집을 수 있다
    expect(screen.getByText('거부')).toBeTruthy()
    expect((screen.getByText('적용 ✓') as HTMLButtonElement).disabled).toBe(false)
  })

  it('확정되면 점선이 사라지고 버튼도 없다', () => {
    const { container } = render(
      <TurnReviewPanel review={review({ status: 'ACCEPTED', isFinalized: true })} onDecide={() => {}} />,
    )

    expect(container.querySelector('.turn-review--provisional')).toBeNull()
    expect(container.querySelector('.turn-review-actions')).toBeNull()
  })
})

describe('판정', () => {
  it('적용을 누르면 accept 로 알린다', () => {
    const onDecide = vi.fn()
    render(<TurnReviewPanel review={review()} onDecide={onDecide} />)

    fireEvent.click(screen.getByText('적용'))
    expect(onDecide).toHaveBeenCalledWith('turn-1', 'accept')
  })

  it('거부를 누르면 reject 로 알린다', () => {
    const onDecide = vi.fn()
    render(<TurnReviewPanel review={review()} onDecide={onDecide} />)

    fireEvent.click(screen.getByText('거부'))
    expect(onDecide).toHaveBeenCalledWith('turn-1', 'reject')
  })

  it('파일별 되돌리기는 그 파일만 지정한다', () => {
    const onDecide = vi.fn()
    render(<TurnReviewPanel review={review()} onDecide={onDecide} />)

    fireEvent.click(screen.getAllByText('되돌리기')[0]!)
    expect(onDecide).toHaveBeenCalledWith('turn-1', 'reject', ['src/a.ts'])
  })

  it('옛 카드는 버튼이 없다 — 마지막 턴만 조작한다', () => {
    const { container } = render(
      <TurnReviewPanel review={review()} actionsDisabled onDecide={() => {}} />,
    )

    expect(container.querySelector('.turn-review-actions')).toBeNull()
    expect(container.querySelector('.turn-review-undo')).toBeNull()
    // 파일 경로는 여전히 보인다
    expect(screen.getByText('src/a.ts')).toBeTruthy()
  })

  it('FAILED 는 손댈 수 없다', () => {
    const { container } = render(
      <TurnReviewPanel review={review({ status: 'FAILED' })} onDecide={() => {}} />,
    )
    expect(container.querySelector('.turn-review-actions')).toBeNull()
  })
})

describe('검증 배지 (ADR-037)', () => {
  it('verified 면 검증됨이 뜨고 명령이 툴팁에 담긴다', () => {
    const { container } = render(
      <TurnReviewPanel
        review={review({ verification: { status: 'verified', commands: ['npm test'] } })}
        onDecide={() => {}}
      />,
    )

    const badge = container.querySelector('.turn-review-verify--ok')!
    expect(badge.textContent).toBe('검증됨')
    expect(badge.getAttribute('title')).toBe('npm test')
  })

  it('unverified 면 사유를 툴팁에 담는다', () => {
    const { container } = render(
      <TurnReviewPanel
        review={review({ verification: { status: 'unverified', reason: '테스트 없음' } })}
        onDecide={() => {}}
      />,
    )

    expect(container.querySelector('.turn-review-verify--warn')!.getAttribute('title')).toBe('테스트 없음')
  })

  it('unverified 여도 적용을 막지 않는다 — 정보성이다', () => {
    render(
      <TurnReviewPanel
        review={review({ verification: { status: 'unverified' } })}
        onDecide={() => {}}
      />,
    )
    expect((screen.getByText('적용') as HTMLButtonElement).disabled).toBe(false)
  })

  it('not_required 면 배지가 없다', () => {
    const { container } = render(
      <TurnReviewPanel review={review({ verification: { status: 'not_required' } })} onDecide={() => {}} />,
    )
    expect(container.querySelector('.turn-review-verify')).toBeNull()
  })
})

// ── 충돌 상태 (DC-1214) ────────────────────────────────
//
// 런타임이 `actions` 로 허용 액션을 내려준다 (handlers.py:90-101).
// 그중 accept_current·mark_resolved 는 런타임에 수행 핸들러가 없어 버튼을 만들지 않는다.

describe('충돌 상태', () => {
  it('ACCEPT_CONFLICT — 거부만 남고 적용은 사라진다', () => {
    const target = review({
      status: 'ACCEPT_CONFLICT',
      actions: ['accept_current', 'reject'],
      files: [{ path: 'src/a.ts', operation: 'modify', conflictReason: '파일이 외부에서 수정됨' }],
    })
    render(<TurnReviewPanel review={target} onDecide={() => {}} />)

    expect(screen.queryByText('적용')).toBeNull()
    expect(screen.getByText('거부')).toBeTruthy()
  })

  it('ACCEPT_CONFLICT — 보낼 수 없는 accept_current 는 버튼으로 만들지 않는다', () => {
    const target = review({ status: 'ACCEPT_CONFLICT', actions: ['accept_current', 'reject'] })
    const { container } = render(<TurnReviewPanel review={target} onDecide={() => {}} />)

    const labels = [...container.querySelectorAll('.turn-review-actions button')].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(['거부'])
  })

  it('RESTORE_CONFLICT — 보낼 수 있는 액션이 없어 판정 버튼이 통째로 없다', () => {
    const target = review({
      status: 'RESTORE_CONFLICT',
      actions: ['accept_current', 'mark_resolved'],
    })
    const { container } = render(<TurnReviewPanel review={target} onDecide={() => {}} />)

    expect(container.querySelector('.turn-review-actions')).toBeNull()
    // 파일별 되돌리기도 reject 가 없으면 함께 사라져야 한다
    expect(screen.queryByText('되돌리기')).toBeNull()
  })

  it('충돌이면 다음에 뭘 해야 하는지 글로 알린다', () => {
    const target = review({
      status: 'RESTORE_CONFLICT',
      actions: ['accept_current', 'mark_resolved'],
    })
    const { container } = render(<TurnReviewPanel review={target} onDecide={() => {}} />)

    expect(container.querySelector('.turn-review-note')).toBeTruthy()
  })

  it('충돌 사유를 화면에 드러낸다 — title 속성에만 두면 닿지 않는다', () => {
    const target = review({
      status: 'ACCEPT_CONFLICT',
      actions: ['accept_current', 'reject'],
      files: [{ path: 'src/a.ts', operation: 'modify', conflictReason: '파일이 외부에서 수정됨' }],
    })
    render(<TurnReviewPanel review={target} onDecide={() => {}} />)

    expect(screen.getByText('파일이 외부에서 수정됨')).toBeTruthy()
  })

  it('MANUAL_RESOLUTION_PENDING — mark_resolved 뿐이라 버튼 없이 안내만', () => {
    const target = review({ status: 'MANUAL_RESOLUTION_PENDING', actions: ['mark_resolved'] })
    const { container } = render(<TurnReviewPanel review={target} onDecide={() => {}} />)

    expect(container.querySelector('.turn-review-actions')).toBeNull()
    expect(container.querySelector('.turn-review-note')).toBeTruthy()
  })
})

describe('런타임 actions 존중', () => {
  it('actions 가 비면 판정 버튼을 내지 않는다 — 이력 재생본이 그렇다', () => {
    const target = review({ status: 'PENDING_DECISION', actions: [] })
    const { container } = render(<TurnReviewPanel review={target} onDecide={() => {}} />)

    expect(container.querySelector('.turn-review-actions')).toBeNull()
    expect(container.querySelector('.turn-review-note')).toBeNull()
  })

  it('actions 가 아예 없으면(구버전 런타임) 종전대로 적용·거부를 낸다', () => {
    const target = review({ status: 'PENDING_DECISION' })
    render(<TurnReviewPanel review={target} onDecide={() => {}} />)

    expect(screen.getByText('적용')).toBeTruthy()
    expect(screen.getByText('거부')).toBeTruthy()
  })

  it('actionsDisabled 면 런타임이 허용해도 버튼이 없다', () => {
    const target = review({ status: 'PENDING_DECISION', actions: ['accept', 'reject'] })
    const { container } = render(
      <TurnReviewPanel review={target} actionsDisabled onDecide={() => {}} />,
    )

    expect(container.querySelector('.turn-review-actions')).toBeNull()
  })
})
