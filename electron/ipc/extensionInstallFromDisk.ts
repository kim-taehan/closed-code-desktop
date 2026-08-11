import { dialog, type BrowserWindow } from 'electron'
import { installPackage } from '../extensions/install'
import type { ExtensionInstallPayload } from '../../shared/ipc/extensionPayloads'

// **파일을 골라 확장을 설치한다.** `extensionBridge.ts` 에서 뽑아 왔다 — 저쪽이 300줄 상한에
// 닿았고, 이건 하나의 흐름이다: 창을 띄우고 → 풀고 → 다시 싣는다.
//
// `extensionManageHandlers.ts` 에 합치지 않았다. 저 파일은 **electron 을 안 문다** —
// 켜기·끄기·지우기를 창 없이 시험할 수 있는 이유가 그것이고, `dialog` 를 들이면 깨진다.

/** 확장 패키지 확장자. 안은 zip 이고, 이름만 우리 것이다 (표준 §4.3). */
const PACKAGE_EXTENSIONS = ['axcx', 'zip']

export interface InstallFromDiskDeps {
  /** 파일 선택창을 띄울 부모 창 */
  window: BrowserWindow
  /** 패키지가 풀리는 곳 */
  extensionsDir: string
  /**
   * 설치가 끝난 뒤 다시 싣는 일. 브리지가 배포처 설치와 **같은 함수**를 넘긴다 —
   * 두 벌이 되면 한쪽만 고쳐져 「디스크로 설치하면 안 뜬다」 같은 것이 생긴다.
   */
  afterInstall(result: ExtensionInstallPayload, replaced: boolean): Promise<ExtensionInstallPayload>
}

export async function installFromDisk(deps: InstallFromDiskDeps): Promise<ExtensionInstallPayload> {
  const picked = await dialog.showOpenDialog(deps.window, {
    title: '확장 패키지 고르기',
    properties: ['openFile'],
    filters: [{ name: '확장 패키지', extensions: PACKAGE_EXTENSIONS }],
  })
  // 창을 닫은 것은 실패가 아니다 — 화면이 오류를 띄우면 안 된다
  if (picked.canceled || picked.filePaths.length === 0) return { ok: false, cancelled: true }

  const result = await installPackage({ packagePath: picked.filePaths[0]!, extensionsDir: deps.extensionsDir })
  if (!result.ok) {
    return { ok: false, reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) }
  }
  return deps.afterInstall(
    { ok: true, name: result.manifest.name, version: result.manifest.version },
    result.replaced,
  )
}
