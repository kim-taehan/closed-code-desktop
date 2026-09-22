// 매니페스트 `contributes.views` 한 항목의 타입과 파서.
//
// `manifest.ts` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았고, 3판(웹뷰)이 들어오면서 뷰가
// **판마다 다른 모양**을 갖게 됐다. 판을 아는 규칙이 한 파일에 모여 있어야 2판을 건드리지
// 않고 3판을 더할 수 있다. `manifest.ts` 가 타입을 그대로 다시 내보내므로 부르는 쪽은
// 어느 파일에서 오는지 몰라도 된다.

/**
 * 앱이 그릴 수 있는 뷰 종류.
 *
 * **`html` 은 원래 없던 것이고, "확장이 HTML 을 들고 오지 않는다" 던 결정을 뒤집은 것이다.**
 * 뒤집은 이유: 목록 → 상세 → 관계로 링크를 타고 다니는 화면은 행 배열로 표현되지 않는다.
 *
 * 뒤집으면서도 지킨 선은 이것이다 — **호스트는 그릴 뿐 내용을 모른다.** 호스트가 특정 확장의
 * 화면 모양("프로그램목록은 이렇게 생겼다")을 알기 시작하면 그것이 결합이다. 격리해 감싸는
 * 일은 `src/state/extensionHtmlDoc.ts` 가 하고, 거기서도 내용은 손대지 않는다.
 *
 * **`webview` 는 3판에만 있다** (확장 재설계 §2-1). 앞의 넷은 앱이 그리거나(표·트리·목록)
 * 확장이 밀어 준 문서를 통째로 갈아끼우는(`html`) 것이라 갱신마다 화면이 다시 떴다.
 * 웹뷰는 확장 패키지의 `ui/` 를 본문 탭에 **한 번** 띄우고 갱신은 메시지로 받는다.
 * 거꾸로 3판은 앞의 넷을 받지 않는다 — 옛 API(`view.setRows` 등)는 6단계에서 사라진다.
 */
export type ExtensionViewKind = 'table' | 'tree' | 'list' | 'html' | 'webview'

export interface ExtensionView {
  id: string
  title: string
  kind: ExtensionViewKind
  /**
   * 웹뷰가 처음 띄울 문서. **확장 디렉토리 기준**이고 반드시 `ui/` 아래다 (`ui/index.html`).
   * `kind: 'webview'` 에만 있다.
   */
  entry?: string
}

/** 2판이 받는 뷰 종류. 3판을 더하면서 **그대로** 뒀다 — 2판 확장이 오늘처럼 돌아야 한다. */
const V2_VIEW_KINDS: ExtensionViewKind[] = ['table', 'tree', 'list', 'html']

/** 웹뷰가 서빙받는 폴더. 매니페스트의 `entry` 는 이 아래여야 한다. */
export const WEBVIEW_UI_DIR = 'ui'

export function toView(value: unknown, manifestVersion: number): ExtensionView | null {
  const source = asRecord(value)
  const id = source['id']
  const title = source['title']
  const kind = source['kind']
  if (typeof id !== 'string' || id === '') return null
  if (typeof title !== 'string' || title === '') return null
  if (manifestVersion >= 3) {
    // 3판은 웹뷰만. 문서 자리가 `ui/` 밖이면 서빙할 수 없으므로 뷰째 버린다
    if (kind !== 'webview') return null
    const entry = webviewEntry(source['entry'])
    return entry === null ? null : { id, title, kind, entry }
  }
  // 앱이 못 그리는 kind 는 담아둬도 쓸 데가 없다
  if (!V2_VIEW_KINDS.some((known) => known === kind)) return null
  return { id, title, kind: kind as ExtensionViewKind }
}

/**
 * `entry` 를 `ui/…` 모양으로 편다. 아니면 null.
 *
 * 여기는 **문자열만** 본다 — 파일이 실제로 있는지, 심링크가 밖을 가리키는지는 서빙하는
 * 쪽(`electron/extensions/uiServer.ts` 가 `resolveInside` 로)이 본다. 매니페스트 파서는
 * renderer 에도 실려 파일시스템을 못 만진다. 그래도 여기서 한 번 거르는 것은, 확장 개발자가
 * `"entry": "index.html"` 을 적었을 때 **뷰가 목록에서 사라지는 것으로** 바로 알게 하려는 것이다.
 */
function webviewEntry(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parts = value.replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.')
  if (value.startsWith('/') || parts.includes('..')) return null
  if (parts[0] !== WEBVIEW_UI_DIR || parts.length < 2) return null
  return parts.join('/')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
