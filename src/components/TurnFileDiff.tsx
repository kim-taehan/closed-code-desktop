import type { TurnFileChange } from '../../shared/protocol/turnReview'
import { buildDiffRows } from '../state/diffRows'
import { FileDiffView } from './FileDiffView'

// 에이전트 변경분을 diff 로 그린다.
//
// 런타임이 준 `changeBlocks` 에서 행을 만드는 것은 **이 경로만의 일**이다.
// git diff 는 unified 텍스트에서 행을 만들어 같은 `FileDiffView` 에 먹인다.

export interface TurnFileDiffProps {
  file: TurnFileChange
}

export function TurnFileDiff({ file }: TurnFileDiffProps) {
  const result = buildDiffRows(file)

  // 빈 화면이면 변경이 없다고 오해한다 — 왜 못 보여주는지 밝힌다
  if (result.kind === 'needs_fetch') {
    return <div className="file-diff-note">내용이 너무 커서 미리보기를 가져오지 못했습니다</div>
  }
  if (result.kind === 'unavailable') {
    return <div className="file-diff-note">{result.reason}</div>
  }

  return <FileDiffView rows={result.rows} />
}
