import { app, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import * as path from 'node:path'

/**
 * 독 아이콘을 브랜드 것으로 바꾼다 (dev 한정).
 *
 * 패키징하면 electron-builder 가 build/icon.icns 를 심지만, 개발 중 `electron .`
 * 로 띄우면 기본 원자 아이콘이 뜬다. macOS 에서만 dock 이 있다.
 *
 * `main.ts` 에서 그대로 옮겨 왔다 — 그 파일이 300줄 상한에 닿았다. 판단은 안 바뀌었다.
 */
export function applyDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  const iconPath = path.join(__dirname, '../../../build/icon.png')
  if (!existsSync(iconPath)) return
  const image = nativeImage.createFromPath(iconPath)
  if (!image.isEmpty()) app.dock.setIcon(image)
}
