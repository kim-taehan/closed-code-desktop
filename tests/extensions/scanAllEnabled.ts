import { scanExtensions } from '../../electron/extensions/registry'
import { withEnabled } from '../../electron/extensions/serviceEnabled'

// 브리지 시험이 **진짜 훑기**를 쓰되 서비스는 안 띄울 때 쓰는 가교.
//
// 브리지가 보는 목록에는 켜짐 표시가 붙어 있는데(`ExtensionSource`), 그것을 붙이는 것은
// 서비스다. 훑기만 쓰는 시험이 각자 흉내내면 규칙이 세 벌로 갈리므로 한곳에 둔다.
// **끄기를 보는 시험은 이걸 쓰지 않는다** — 그쪽은 서비스를 실제로 띄운다
// (`electron/extensions/serviceDisabled.test.ts`).

export async function scanAllEnabled(dir: string) {
  const scan = await scanExtensions(dir)
  return { ...scan, extensions: withEnabled(scan.extensions, new Set<string>()) }
}
