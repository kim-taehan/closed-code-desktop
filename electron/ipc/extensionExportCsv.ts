import { writeFile } from 'node:fs/promises'
import { describeError } from '../../shared/errors/describeError'
import { dialog, type BrowserWindow } from 'electron'
import type {
  ExtensionExportCsvPayload,
  ExtensionExportCsvResult,
} from '../../shared/ipc/extensionPayloads'

// 확장 결과 표를 CSV 파일로 저장한다. `extensionBridge.ts` 에서 갈라냈다 —
// 저쪽이 300줄 상한에 닿아 `view.setHtml` 배선을 얹을 자리가 없었다.
// 선례: `extensionRegistryHandlers.ts`(상태를 안 쥐는 핸들러를 함수로 뺀 것).

/**
 * **CSV 내용은 화면이 만들어 넘긴다** — 무엇을 내보낼지(거르고 정렬한 지금 상태)는
 * 화면만 아는 것이라, main 이 다시 계산할 수 있는 값이 아니다.
 *
 * 저장 위치는 프로젝트 안이 아니다. 내보내기는 앱 밖으로 들고 나가는 행위라
 * `ProjectFs` 의 경계를 태우지 않는다 — 대신 **사용자가 대화상자로 고른 경로**만 쓴다.
 * 화면이 준 문자열이 경로가 되는 자리는 없다.
 */
export async function exportExtensionCsv(
  window: BrowserWindow,
  payload: ExtensionExportCsvPayload,
): Promise<ExtensionExportCsvResult> {
  const picked = await dialog.showSaveDialog(window, {
    title: 'CSV 로 내보내기',
    defaultPath: payload.suggestedName,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  // 창을 닫은 것은 실패가 아니다 — 화면이 오류를 띄우면 안 된다
  if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true }

  try {
    // BOM 을 붙인다. 안 붙이면 Excel 이 UTF-8 을 못 알아보고 한글이 깨진다 —
    // 이 표의 값에는 한글 경로가 그대로 들어온다.
    await writeFile(picked.filePath, `﻿${payload.csv}`, 'utf8')
    return { ok: true, path: picked.filePath }
  } catch (error) {
    return { ok: false, reason: describeError(error) }
  }
}
