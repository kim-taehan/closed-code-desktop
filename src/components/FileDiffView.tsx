import { useState } from 'react'
import type { DiffRow } from '../state/diffRows'

// 파일 하나의 변경 내용을 그린다. **행을 만들지 않는다.**
//
// 행을 어디서 얻는지가 소비자마다 다르다 — 에이전트 변경분은 런타임이 준
// changeBlocks 에서(TurnFileDiff), git 은 unified diff 텍스트에서 만든다.
// 그리는 쪽이 그 차이를 알 이유가 없어 `DiffRow[]` 만 받는다.

/** 한 번에 그릴 최대 행. 넘으면 접어둔다 — 수천 줄을 한꺼번에 그리면 화면이 멈춘다. */
const MAX_ROWS = 400

export interface FileDiffViewProps {
  rows: DiffRow[]
}

export function FileDiffView({ rows: all }: FileDiffViewProps) {
  const [showAll, setShowAll] = useState(false)

  const truncated = !showAll && all.length > MAX_ROWS
  const rows = truncated ? all.slice(0, MAX_ROWS) : all

  return (
    <div className="file-diff">
      <table className="file-diff-table">
        <tbody>
          {rows.map((row, index) => (
            <DiffRowView key={`${row.kind}-${index}`} row={row} />
          ))}
        </tbody>
      </table>
      {truncated && (
        <button type="button" className="file-diff-more" onClick={() => setShowAll(true)}>
          ▼ 나머지 {all.length - MAX_ROWS}줄 더 보기
        </button>
      )}
    </div>
  )
}

function DiffRowView({ row }: { row: DiffRow }) {
  if (row.kind === 'gap') {
    return (
      <tr className="file-diff-row file-diff-row--gap">
        <td className="file-diff-num" colSpan={2} />
        <td className="file-diff-text">{row.text}</td>
      </tr>
    )
  }

  const marker = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '

  return (
    <tr className={`file-diff-row file-diff-row--${row.kind}`}>
      <td className="file-diff-num">{row.oldLine ?? ''}</td>
      <td className="file-diff-num">{row.newLine ?? ''}</td>
      <td className="file-diff-text">
        <span className="file-diff-marker">{marker}</span>
        {row.text}
      </td>
    </tr>
  )
}
