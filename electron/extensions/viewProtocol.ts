import { VIEW_SCHEME, type ExtensionViewHost } from './viewHost'
import type { ExtensionUiServer } from './uiServer'

// `code-ext://` 스킴을 **등록하고 처리하는** 자리. `main.ts` 에서 갈라냈다 — 저쪽이 300줄 상한에
// 닿았고, 호스트가 둘(`view`·`ui`)로 늘면서 「어느 요청을 누구에게」가 판단이 됐다.
//
// - `code-ext://view/<토큰>` — 확장이 밀어 준 HTML 한 장 (`viewHost.ts`, 2판)
// - `code-ext://ui/<토큰>/<경로>` — 확장 패키지의 `ui/` 폴더 (`uiServer.ts`, 3판 웹뷰)
//
// electron 을 import 하지 않는다 — `protocol` 을 받아 쓴다. 그래야 갈래 판단을 시험할 수 있다.

/** 여기서 쓰는 `protocol` 표면만 */
export interface SchemeProtocol {
  registerSchemesAsPrivileged(
    schemes: { scheme: string; privileges: { standard?: boolean; secure?: boolean } }[],
  ): void
  handle(scheme: string, handler: (request: { url: string }) => Promise<Response> | Response): void
}

/**
 * **app ready 전에** 불러야 한다 (Electron 규칙). 그래서 `main.ts` 의 모듈 최상위에서 부른다.
 *
 * - `standard` — URL 에 host(`view`·`ui`)를 두고, 상대 경로(`./app.js`)를 풀려면 필요하다
 * - `secure` — 안 주면 프레임이 비보안으로 막힌다
 *
 * **`corsEnabled` 는 주지 않는다** (2026-09-22 실측, Electron 33.4.11). 웹뷰 문서는 opaque origin
 * 이라 CORS 로 받는 요청(`type="module"` 스크립트와 그 안의 상대 `import`, `@font-face` 글꼴)이
 * 막힐 것으로 예상했는데, 이 둘만으로 전부 실렸다. 필요 없는 권한은 넓히지 않는다.
 */
export function registerViewScheme(protocol: SchemeProtocol): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: VIEW_SCHEME, privileges: { standard: true, secure: true } },
  ])
}

/** 창보다 먼저 건다 — 창이 뜨자마자 확장 탭이 복원될 수 있다. */
export function handleViewProtocol(protocol: SchemeProtocol, views: ExtensionViewHost, ui: ExtensionUiServer): void {
  protocol.handle(VIEW_SCHEME, async (request) => {
    if (new URL(request.url).host === 'ui') {
      const served = await ui.handle(request.url)
      return new Response(served.body, { status: served.status, headers: served.headers })
    }
    const served = views.handle(request.url)
    return new Response(served.body, {
      status: served.status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  })
}
