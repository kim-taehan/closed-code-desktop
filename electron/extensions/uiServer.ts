import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { resolveInside } from '../fs/resolveInside'
import { WEBVIEW_UI_DIR } from '../../shared/extensions/manifestViews'
import { VIEW_SCHEME } from './viewHost'

// 웹뷰 탭(매니페스트 3판)의 **정적 앞단**을 서빙한다. `code-ext://ui/<토큰>/<경로>`.
//
// `viewHost.ts`(`code-ext://view/<토큰>`)와 스킴은 같고 하는 일이 다르다. 저쪽은 확장이 밀어 준
// 문서 **한 장**을 들고 있다가 갱신마다 새 토큰으로 갈아끼웠다 — 그래서 화면이 매번 다시 떴다
// (확장 재설계 §1 「계속 다시 그린다」). 이쪽은 확장 패키지의 `ui/` 폴더를 통째로 서빙하고,
// **토큰은 탭이 열릴 때 한 번** 나와 탭이 살아 있는 동안 바뀌지 않는다. 갱신은 메시지로 간다.
//
// 토큰 하나가 묶는 것: (그 확장의 `ui/` · 프로젝트 · 뷰). 메시지를 어느 탭에 줄지도 이 묶음으로
// 가린다 — iframe 이 누구인지는 곧 토큰이 누구인지다.
//
// 격리는 `viewHost.ts` 머리말 그대로다 (`sandbox="allow-scripts"` → opaque origin). 달라진 것은
// CSP 가 **문서의 `<meta>` 가 아니라 응답 헤더**로 간다는 것 — 문서를 확장이 쓰므로 앱이 끼워
// 넣을 자리가 없다. 헤더가 문서보다 먼저 걸리고, 확장이 `<meta>` 로 더 풀 수도 없다
// (CSP 는 겹치면 빡빡한 쪽이 이긴다).

/** 토큰이 묶는 것. 앞의 셋이 메시지 행선지, `uiDir` 이 서빙 뿌리다. */
export interface UiBinding {
  extension: string
  viewId: string
  projectId: string
  /** 실경로로 편 그 확장의 `ui/`. 이 밖은 한 바이트도 안 나간다 */
  uiDir: string
}

export interface UiOpenTarget {
  extension: string
  viewId: string
  projectId: string
  /** 확장 설치 디렉토리 */
  extensionDir: string
  /** 매니페스트의 `entry` — 파서가 이미 `ui/…` 모양으로 폈다 (`manifestViews.ts`) */
  entry: string
}

export type UiOpenResult = { ok: true; token: string; url: string } | { ok: false; reason: string }

export interface UiServed {
  status: number
  body: Uint8Array | string
  headers: Record<string, string>
}

/**
 * 확장자 → content-type. **여기 없는 것은 `application/octet-stream`** 이다 — 모르는 것을
 * 추측해 `text/html` 로 내면 그 파일이 문서로 실행된다 (`nosniff` 와 같은 방향).
 */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

const NOT_FOUND: UiServed = {
  status: 404,
  body: '<!doctype html><meta charset="utf-8">찾을 수 없는 확장 화면 파일입니다.',
  headers: { 'content-type': 'text/html; charset=utf-8' },
}

export class ExtensionUiServer {
  private readonly bindings = new Map<string, UiBinding>()

  /** 토큰 만들기. 시험이 갈아끼운다 — 기본은 추측할 수 없는 값이다 */
  constructor(private readonly newToken: () => string = randomUUID) {}

  /**
   * 탭 하나를 연다 — 토큰을 새로 내고 iframe 에 넣을 URL 을 돌려준다.
   *
   * **탭마다 한 번만 부른다.** 여기서 새 토큰이 나오면 새 문서가 뜨는 것이고, 그것이 없애려던
   * 「갱신마다 다시 뜬다」다. 부르는 쪽(탭 컴포넌트)이 마운트될 때 한 번 부르고 닫을 때 놓는다.
   */
  async open(target: UiOpenTarget): Promise<UiOpenResult> {
    const uiDir = await resolveInside(target.extensionDir, WEBVIEW_UI_DIR)
    if (uiDir === null) return { ok: false, reason: `확장에 ${WEBVIEW_UI_DIR}/ 폴더가 없습니다` }
    const entry = target.entry.split('/').slice(1).join('/')
    const file = await resolveInside(uiDir, entry)
    if (file === null || !(await isFile(file))) {
      return { ok: false, reason: `화면 문서를 찾을 수 없습니다: ${target.entry}` }
    }
    const token = this.newToken()
    this.bindings.set(token, {
      extension: target.extension,
      viewId: target.viewId,
      projectId: target.projectId,
      uiDir,
    })
    return { ok: true, token, url: `${baseOf(token)}${entry.split('/').map(encodeURIComponent).join('/')}` }
  }

  binding(token: string): UiBinding | null {
    return this.bindings.get(token) ?? null
  }

  /**
   * (확장·뷰·프로젝트)가 **셋 다** 맞는 열린 탭들. 뒷단 메시지의 행선지다.
   *
   * 프로젝트를 빼면 안 된다 — 같은 확장의 같은 뷰가 두 프로젝트에 열려 있을 수 있고,
   * P 의 결과가 Q 의 탭에 뜨면 사람은 그것을 Q 의 산출물로 읽는다 (`projectEnvelope.ts` 머리말).
   */
  tokensOf(extension: string, viewId: string, projectId: string): string[] {
    return [...this.bindings]
      .filter(([, bound]) => bound.extension === extension && bound.viewId === viewId && bound.projectId === projectId)
      .map(([token]) => token)
  }

  /** 탭을 닫으면 놓는다. 그 뒤로 그 토큰의 파일 요청은 404 다 */
  release(token: string): void {
    this.bindings.delete(token)
  }

  /** 창이 사라지면 탭도 전부 사라졌다 */
  clear(): void {
    this.bindings.clear()
  }

  /**
   * `protocol.handle` 이 부르는 처리기 (`code-ext://ui/…` 만 여기로 온다, `viewProtocol.ts`).
   *
   * 404 로 떨어지는 것: 모르는(놓은) 토큰 · 경로 없음 · `ui/` 밖(`..`·심링크) · 디렉토리.
   * 밖인지 판정하는 것은 `resolveInside` 하나다 — 문자열로 `..` 를 세는 것은 여기서 하지 않는다.
   * 인코딩된 `..`·구분자(`%2e%2e`·`%2F`·`%5C`)도 풀린 뒤 **마지막 경로**로 거기서 걸린다
   * (`uiServer.test.ts`). 조각마다 따로 막는 겹을 한 번 뒀다가 뺐다 — 그 겹을 지워도 시험이 전부
   * 초록이었다. 판정이 두 곳이면 언젠가 한쪽만 고쳐진다.
   */
  async handle(url: string): Promise<UiServed> {
    const parsed = parseUiUrl(url)
    if (parsed === null) return NOT_FOUND
    const bound = this.bindings.get(parsed.token)
    if (bound === undefined || parsed.path === '') return NOT_FOUND
    const file = await resolveInside(bound.uiDir, parsed.path)
    if (file === null || !(await isFile(file))) return NOT_FOUND
    let body: Uint8Array
    try {
      body = await readFile(file)
    } catch {
      return NOT_FOUND
    }
    return {
      status: 200,
      body,
      headers: {
        'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-security-policy': uiPolicy(parsed.token),
        'x-content-type-options': 'nosniff',
        // **캐시하지 않는다.** 같은 확장을 덮어써 업데이트해도 토큰은 새로 나오지만,
        // 캐시가 경로만 보고 옛 스크립트를 돌려주는 경우를 애초에 만들지 않는다
        'cache-control': 'no-store',
      },
    }
  }
}

/**
 * 웹뷰 문서의 CSP (E2). **응답 헤더로 간다** — 머리말.
 *
 * - 바깥 네트워크 없음: `connect-src 'none'` 이고 어느 자리에도 바깥 출처를 적지 않는다.
 * - 스크립트·스타일·그림·글꼴은 **그 토큰의 `ui/` 에서만.** `'self'` 로 적지 않고 토큰 경로를
 *   이름으로 적는다 — `'self'` 는 `code-ext://ui` 전체라 **남의 탭 토큰 아래**도 허용한다.
 * - 인라인 스크립트는 막는다. 확장은 자기 파일로 스크립트를 싣는다 (`viewHost.ts` 의 인라인
 *   다리는 앱이 문서를 만들던 시절의 것이다).
 * - `'wasm-unsafe-eval'` — 확장이 wasm 을 싣는 경우를 위해 content-type 을 두었다. 다만
 *   `connect-src 'none'` 이라 `fetch` 로 받는 길은 막혀 있다 — 바이트에서 `WebAssembly.compile` 만 된다.
 * - 그림·글꼴의 `data:` 는 네트워크가 아니라 연다 (옛 `extensionHtmlDoc.ts` 와 같다).
 *
 * **실측 (2026-09-22, Electron 33.4.11, sandbox iframe + 이 헤더):** 고전·모듈 스크립트(상대 `import`
 * 포함)·스타일시트·그림·글꼴 요청이 실렸다. 막힌 것: 인라인 `<script>`·`<style>`·`style=` 속성,
 * `fetch`(자기 `ui/` 파일 포함·바깥), **다른 토큰 경로의 스크립트**. 문서는 `origin === 'null'` 이고
 * `parent.document` 에 `SecurityError`. `'self'` 대신 토큰 경로를 이름으로 적은 것이 그대로 먹었다.
 */
export function uiPolicy(token: string): string {
  const base = baseOf(token)
  return [
    "default-src 'none'",
    `script-src ${base} 'wasm-unsafe-eval'`,
    `style-src ${base}`,
    `img-src ${base} data:`,
    `font-src ${base} data:`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

function baseOf(token: string): string {
  return `${VIEW_SCHEME}://ui/${token}/`
}

/**
 * `code-ext://ui/<토큰>/a/b.js` → `{ token, path: 'a/b.js' }`. 모양이 아니면 null.
 *
 * `URL` 이 `..` 를 이미 접어 둔다 (표준 스킴이라 — `main.ts` 의 `standard: true`). 그래서
 * `code-ext://ui/<토큰>/../x` 는 토큰 자리가 `x` 가 되어 모르는 토큰으로 떨어진다.
 */
function parseUiUrl(url: string): { token: string; path: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${VIEW_SCHEME}:` || parsed.host !== 'ui') return null
  const [token, ...rest] = parsed.pathname.split('/').filter((part) => part !== '')
  if (token === undefined) return null
  try {
    return { token, path: rest.map((part) => decodeURIComponent(part)).join('/') }
  } catch {
    // 깨진 퍼센트 인코딩 — 어느 파일도 가리키지 않는다
    return null
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
