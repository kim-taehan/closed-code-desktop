// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { parseTurnReview } from '../../shared/protocol/parseTurnReview'
import type { TurnFileChange } from '../../shared/protocol/turnReview'
import { FileDiffView } from './FileDiffView'
import { TurnFileDiff } from './TurnFileDiff'
import { buildDiffRows } from '../state/diffRows'

afterEach(cleanup)

function fileOf(raw: Record<string, unknown>): TurnFileChange {
  return parseTurnReview({ turnId: 't1', files: [{ path: 'a.ts', ...raw }] })!.files[0]!
}

/** 렌더러가 이제 행을 직접 받는다. 준비부만 바뀌고 단언은 그대로다. */
function rowsOf(raw: Record<string, unknown>) {
  return rowsOfFile(fileOf(raw))
}

function rowsOfFile(file: TurnFileChange) {
  const result = buildDiffRows(file)
  if (result.kind !== 'rows') throw new Error(`행을 만들 수 없습니다: ${result.kind}`)
  return result.rows
}

const SIMPLE = {
  baseline: 'a\nb\nc',
  modified: 'a\nx\nc',
  changeBlocks: [
    {
      kind: 'replace',
      oldRange: { startLine: 2, endLine: 2 },
      newRange: { startLine: 2, endLine: 2 },
      deletedText: 'b',
    },
  ],
}

describe('행 렌더', () => {
  it('추가·삭제·문맥 행을 구분해 그린다', () => {
    const { container } = render(<FileDiffView rows={rowsOf(SIMPLE)} />)

    expect(container.querySelectorAll('.file-diff-row--add')).toHaveLength(1)
    expect(container.querySelectorAll('.file-diff-row--del')).toHaveLength(1)
    expect(container.querySelectorAll('.file-diff-row--context')).toHaveLength(2)
  })

  it('내용을 그대로 보여준다', () => {
    const { container } = render(<FileDiffView rows={rowsOf(SIMPLE)} />)
    const del = container.querySelector('.file-diff-row--del')!

    expect(del.textContent).toContain('b')
  })

  it('삭제 행에는 옛 줄번호만, 추가 행에는 새 줄번호만 나온다', () => {
    const { container } = render(<FileDiffView rows={rowsOf(SIMPLE)} />)

    const delNums = [...container.querySelectorAll('.file-diff-row--del .file-diff-num')].map(
      (cell) => cell.textContent,
    )
    expect(delNums).toEqual(['2', ''])

    const addNums = [...container.querySelectorAll('.file-diff-row--add .file-diff-num')].map(
      (cell) => cell.textContent,
    )
    expect(addNums).toEqual(['', '2'])
  })

  // 접힘 표시는 **파일의 줄이 아니다** — 줄번호를 달면 없는 줄이 있는 것처럼 보인다.
  // 문구는 만든 쪽(`diffRows`)의 것을 그대로 낸다.
  it('접힘 표시는 줄번호 없이 문구만 낸다', () => {
    const { container } = render(
      <FileDiffView
        rows={[
          { kind: 'context', text: 'a', oldLine: 1, newLine: 1 },
          { kind: 'gap', text: '⋯ 40줄 생략' },
          { kind: 'context', text: 'z', oldLine: 42, newLine: 42 },
        ]}
      />,
    )

    const gap = container.querySelector('.file-diff-row--gap')!
    expect(gap.textContent).toBe('⋯ 40줄 생략')
    expect(gap.querySelectorAll('.file-diff-num')).toHaveLength(1)
    expect(gap.querySelector('.file-diff-num')?.getAttribute('colspan')).toBe('2')
  })
})

describe('큰 변경', () => {
  it('행이 아주 많으면 접어두고 더 보기를 준다', () => {
    const lines = Array.from({ length: 900 }, (_, i) => `line${i + 1}`)
    const file = fileOf({
      operation: 'create',
      baseline: '',
      modified: lines.join('\n'),
      changeBlocks: [
        { kind: 'insert', oldRange: { startLine: 1, endLine: 0 }, newRange: { startLine: 1, endLine: 900 } },
      ],
    })

    const { container } = render(<FileDiffView rows={rowsOfFile(file)} />)
    expect(container.querySelectorAll('.file-diff-row')).toHaveLength(400)
    expect(screen.getByText(/나머지 500줄 더 보기/)).toBeTruthy()
  })

  it('더 보기를 누르면 전부 나온다', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line${i + 1}`)
    const file = fileOf({
      operation: 'create',
      baseline: '',
      modified: lines.join('\n'),
      changeBlocks: [
        { kind: 'insert', oldRange: { startLine: 1, endLine: 0 }, newRange: { startLine: 1, endLine: 500 } },
      ],
    })

    const { container } = render(<FileDiffView rows={rowsOfFile(file)} />)
    fireEvent.click(screen.getByText(/더 보기/))

    expect(container.querySelectorAll('.file-diff-row')).toHaveLength(500)
  })
})

describe('못 보여주는 경우', () => {
  it('ref 마커면 안내를 보여준다 — 빈 화면이면 변경이 없다고 오해한다', () => {
    render(<TurnFileDiff file={fileOf({ baseline: { ref: 'abc' }, modified: 'x' })} />)
    expect(screen.getByText(/너무 커서/)).toBeTruthy()
  })

  it('내용이 없으면 사유를 보여준다', () => {
    render(<TurnFileDiff file={fileOf({ baseline: null, modified: null })} />)
    expect(screen.getByText(/가져오지 못했습니다/)).toBeTruthy()
  })
})
