import { csvFileName, rowsToCsv } from './extensionRowCsv'
import { describeError } from '../../shared/errors/describeError'
import { sortRows, type RowSort } from './extensionRowSort'
import type { ExtensionRow } from './extensionRows'

// 보고 있는 표를 **파일로 들고 나가는** 일.
//
// `ExtensionViewPanel` 안에 있던 것을 그대로 옮겼다 — 저쪽이 300줄 상한에 두 줄 남아
// 있어서, 무엇을 더하려면 이 갈래가 먼저 나와야 했다 (`ExtensionTablePane` 선례와 같다).
// 표를 만드는 일(`extensionRowCsv`)과 파일로 쓰는 일(IPC)을 잇는 것이 전부다.

/**
 * 화면 그대로 내보낸다 — 거른 것도 정렬한 것도 지금 보고 있는 상태다.
 *
 * 다만 표가 200행까지만 그리는 것과 달리 **거른 전부**를 넘긴다. 내보내기는 눈으로
 * 보는 것이 아니라 들고 나가는 것이라, 화면 상한이 파일 상한일 이유가 없다.
 *
 * **창을 닫은 것은 실패가 아니다** — 그때는 아무 말도 하지 않는다.
 */
export function exportRowsCsv(args: {
  /** 파일 이름의 바탕. 보통 뷰 제목이다 */
  title: string
  /** 거른 뒤의 행 전부 */
  rows: ExtensionRow[]
  sort: RowSort | null
  onNotice: (text: string) => void
}): void {
  void window.davis
    .exportExtensionCsv({
      suggestedName: csvFileName(args.title),
      csv: rowsToCsv(sortRows(args.rows, args.sort)),
    })
    .then((result) => {
      if (result.ok) args.onNotice(`${args.rows.length}행을 저장했습니다: ${result.path}`)
      else if (!result.cancelled) args.onNotice(`내보내지 못했습니다: ${result.reason}`)
    })
    .catch((error: unknown) => {
      args.onNotice(`내보내지 못했습니다: ${describeError(error)}`)
    })
}
