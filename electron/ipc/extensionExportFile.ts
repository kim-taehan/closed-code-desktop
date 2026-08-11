import { writeFile } from 'node:fs/promises'
import { dialog, type BrowserWindow } from 'electron'

// 확장이 만든 문서(`davis.export.save`)를 사용자가 고른 곳에 저장한다.
//
// `extensionExportCsv.ts` 와 **자리는 같고 주인이 다르다.** 저쪽은 화면이 만든 CSV 를
// 내보내고(행만 있으면 앱이 만들 수 있다), 이쪽은 확장이 만든 문서를 내보낸다
// (양식을 확장만 안다 — 고객사마다 다르다).
//
// 저장 위치는 프로젝트 안이 아니다. 내보내기는 앱 밖으로 들고 나가는 행위라
// `ProjectFs` 의 경계를 태우지 않는다 — 대신 **사용자가 대화상자로 고른 경로**만 쓴다.
// 확장이 준 문자열이 경로가 되는 자리는 없다 (`fileName` 은 대화상자의 **기본값**일 뿐이고,
// 사용자가 그대로 두든 바꾸든 최종 경로는 대화상자가 돌려준 것이다).

/**
 * 저장한 절대경로. 사용자가 창을 닫으면 `null` — **취소는 실패가 아니다.**
 * 쓰기가 실패하면 던진다. 사유는 확장까지 그대로 올라간다 (표준 §5.3 "실패는 사유와 함께").
 *
 * 창이 없을 수 있다: 확장 호스트는 **앱 수명**이라 창을 만들기 전에 뜨고(`main.ts`
 * `startExtensionHost`), mac 은 창을 다 닫아도 앱이 산다. 그때 대화상자를 띄울 부모가 없다.
 */
export async function exportExtensionFile(
  window: BrowserWindow | null,
  fileName: string,
  text: string,
): Promise<string | null> {
  if (!window) throw new Error('창이 없어 내보내기 대화상자를 띄울 수 없습니다')

  const picked = await dialog.showSaveDialog(window, {
    title: '내보내기',
    defaultPath: fileName,
  })
  if (picked.canceled || !picked.filePath) return null

  // CSV 와 달리 **BOM 을 붙이지 않는다.** 저쪽은 Excel 이 UTF-8 을 못 알아보는 것을 피하려는
  // 것이고, 이쪽이 내는 것은 마크다운이다 — BOM 이 붙으면 첫 줄의 `#` 앞에 보이지 않는
  // 글자가 생겨 제목이 제목으로 안 읽히는 변환기가 있다.
  await writeFile(picked.filePath, text, 'utf8')
  return picked.filePath
}
