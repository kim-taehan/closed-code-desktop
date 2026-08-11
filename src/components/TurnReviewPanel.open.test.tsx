// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { parseTurnReview } from '../../shared/protocol/parseTurnReview'
import type { TurnReview } from '../../shared/protocol/turnReview'
import { TurnReviewPanel } from './TurnReviewPanel'

// 리뷰 카드에서 파일을 여는 경로. 본체 테스트(TurnReviewPanel.test.tsx)에서 갈라져 나왔다 —
// 첫 변경 지점으로 이동이 붙으면서 한 파일에 담기에 길어졌다.

afterEach(cleanup)

function review(overrides: Record<string, unknown> = {}): TurnReview {
  return parseTurnReview({
    turnId: 'turn-1',
    status: 'PENDING_DECISION',
    files: [{ path: 'src/a.ts', operation: 'modify', additions: 3, deletions: 1 }],
    ...overrides,
  })!
}

describe('파일 열기', () => {
  it('경로를 누르면 알린다', () => {
    const onOpenFile = vi.fn()
    render(<TurnReviewPanel review={review()} onDecide={() => {}} onOpenFile={onOpenFile} />)

    fireEvent.click(screen.getByText('src/a.ts'))
    expect(onOpenFile).toHaveBeenCalledWith('src/a.ts', undefined)
  })

  // 파일 맨 위를 보여주면 무엇이 바뀌었는지 찾아 내려가야 한다.
  // 줄 번호는 런타임이 준 범위 그대로 — 우리가 다시 계산하지 않는다.
  it('첫 변경 지점의 줄을 함께 넘긴다', () => {
    const onOpenFile = vi.fn()
    const target = review({
      files: [
        {
          path: 'src/a.ts',
          operation: 'modify',
          changeBlocks: [
            { kind: 'replace', oldRange: { startLine: 40, endLine: 42 }, newRange: { startLine: 40, endLine: 43 } },
            { kind: 'insert', oldRange: { startLine: 90, endLine: 89 }, newRange: { startLine: 90, endLine: 91 } },
          ],
        },
      ],
    })
    render(<TurnReviewPanel review={target} onDecide={() => {}} onOpenFile={onOpenFile} />)

    fireEvent.click(screen.getByText('src/a.ts'))
    expect(onOpenFile).toHaveBeenCalledWith('src/a.ts', 40)
  })

  it('변경 블록이 없으면 줄을 주지 않는다 — 뷰어는 맨 위 그대로', () => {
    const onOpenFile = vi.fn()
    const target = review({ files: [{ path: 'src/new.ts', operation: 'create', changeBlocks: [] }] })
    render(<TurnReviewPanel review={target} onDecide={() => {}} onOpenFile={onOpenFile} />)

    fireEvent.click(screen.getByText('src/new.ts'))
    expect(onOpenFile).toHaveBeenCalledWith('src/new.ts', undefined)
  })

  it('openable 이 false 면 누를 수 없다', () => {
    const target = review({
      files: [{ path: 'big.ts', operation: 'modify', openable: false }],
    })
    render(<TurnReviewPanel review={target} onDecide={() => {}} onOpenFile={() => {}} />)

    expect((screen.getByText('big.ts') as HTMLButtonElement).disabled).toBe(true)
  })
})

