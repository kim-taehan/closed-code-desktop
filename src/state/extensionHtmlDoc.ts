// 확장이 준 HTML 을 **격리한 문서**로 감싼다. `<iframe srcdoc>` 에 그대로 들어간다.
//
// 왜 격리가 필수인가: 여기는 Electron renderer 다. 확장 HTML 을 그냥 붙이면 앱 화면과
// 같은 문서·같은 출처가 되고, 그 순간 확장이 앱의 DOM·저장소·`window.davis`(= main 으로 가는
// IPC 표면)에 손댈 수 있다. 확장 호스트(자식 프로세스)는 애초에 샌드박스가 아니지만
// (`hostEntry.ts` 의 `require` 가 평범한 Node require 다), **화면까지 열어 줄 이유는 없다.**
//
// 이 문서는 **`srcdoc` 이 아니라 URL 로** 실린다 (`code-ext://`, `electron/extensions/viewHost.ts`).
// srcdoc 문서는 앱 CSP 를 물려받아 여기 적은 `script-src` 가 통째로 무시된다 — 실측으로
// 클릭 다리가 죽었다. URL 로 실린 문서만 아래 정책이 정본이 된다.
//
// 격리는 두 겹이다:
//  1. `<iframe sandbox="allow-scripts">` — `allow-same-origin` 을 **주지 않는다.** 출처가
//     opaque 라 부모 DOM·쿠키·localStorage·`window.davis` 에 닿지 못한다.
//     둘을 같이 주면 샌드박스가 무의미해진다.
//  2. CSP `default-src 'none'` — 바깥 네트워크가 전부 막힌다. 에어갭 제약과 같은 방향이고,
//     확장 화면이 사내 자료를 밖으로 실어 나를 통로를 없앤다.
//
// **확장 스크립트를 막지 않는다.** 원래는 nonce 로 아래 다리만 돌게 했는데 되돌렸다 —
// 확장 호스트(자식)가 애초에 샌드박스가 아니라(`hostEntry.ts` 의 `require` 가 평범한 Node
// require 다) 확장은 이미 `fs`·`child_process` 를 쓴다. 화면 안에서만 막는 것은 악의를
// 못 막으면서 정렬·접기 같은 정상 기능만 죽인다. 실제 울타리는 위의 두 겹이다.
// (nonce 와 `'unsafe-inline'` 은 **같이 못 쓴다** — nonce 가 있으면 `'unsafe-inline'` 이 무시된다.)
//
// 확장이 주는 것은 **본문 조각**이다 (`<div>…</div>`). 전체 문서(`<html>`)를 줘도 브라우저가
// 대충 펴서 그리기는 하지만, `<head>` 가 사라져 스타일이 어긋난다.
//
// 이 파일은 확장이 준 HTML 을 **읽지도 고치지도 않는다.** 감싸기만 한다 — 호스트가 내용을
// 아는 쪽으로 한 발이라도 가면 그것이 결합이다 (`shared/extensions/manifest.ts` 머리말).

/** 확장 화면이 "이 파일을 열어달라" 고 부모에게 보낼 때 쓰는 표식. */
export const EXTENSION_OPEN_MESSAGE = 'code:extension-view-open'

/**
 * 확장 화면이 "내 명령을 돌려달라" 고 부모에게 보낼 때 쓰는 표식.
 *
 * **`EXTENSION_OPEN_MESSAGE` 를 재활용하지 않는다.** 「파일을 열어라」와 「명령을 돌려라」는
 * 다른 사실이고, 섞으면 받는 쪽이 문자열 모양으로 경로인지 명령 id 인지 추측하게 된다
 * (`rpc.ts` 의 `METHOD_REDRAW`/`METHOD_ACTIVE_FILE` 을 가른 것과 같은 이유).
 */
export const EXTENSION_COMMAND_MESSAGE = 'code:extension-view-command'

/** 부모가 받는 열기 요청. 모양이 아니면 버린다 (`isOpenRequest`). */
export interface ExtensionOpenRequest {
  path: string
  /** 1-based. 없으면 파일만 연다 — 행 규약(`extensionRowTarget.ts`)과 같다. */
  line?: number
}

/**
 * 부모가 받는 명령 요청.
 *
 * 실을 수 있는 것은 **명령 id 와 대상 하나**다. 대상은 호스트의 기존 계약인
 * `selection`(사용자가 고른 것)으로 그대로 흘러간다 — 새 통로를 내지 않는다.
 *
 * 왜 대상이 필요한가 (2026-08-14 실측): 확장 화면 안에서 고른 것은 **문서 안에 머문다**.
 * 그래서 「이 화면의 시나리오를 만들어라」 같은 명령이 대상 없이 성립하지 않았다.
 * 처음에는 id 하나만 통과시켰는데, 그러면 확장이 만들 수 있는 것이 「전부에 대해」뿐이다.
 */
export interface ExtensionCommandRequest {
  commandId: string
  /** 그 명령이 겨누는 것 하나 (없을 수 있다). 문자열 말고는 안 받는다. */
  target?: string
}

/**
 * 확장 화면에 입힐 앱 색.
 *
 * iframe 은 **별개 문서라 `--dc-*` 변수를 물려받지 못한다.** 넘겨 주지 않으면 확장 화면만
 * 흰 배경으로 떠서 테마를 바꿔도 혼자 남는다. 그래서 지금 테마의 값을 읽어 심는다.
 */
export interface ExtensionHtmlPalette {
  bg: string
  text: string
  muted: string
  border: string
  surface: string
  accent: string
}

/** 테마 값을 못 읽었을 때 (jsdom·초기 렌더). 앱 기본값인 다크와 같다. */
const FALLBACK: ExtensionHtmlPalette = {
  bg: '#0d1117',
  text: '#e6edf3',
  muted: '#8b949e',
  border: 'rgba(139, 148, 158, 0.3)',
  surface: 'rgba(128, 128, 128, 0.08)',
  accent: '#79c0ff',
}

/**
 * CSS 값으로 심어도 되는 것만 남긴다.
 *
 * 색은 우리 스타일시트에서 읽으므로 위험한 값이 아니지만, **선언이나 규칙을 빠져나갈 수 있는
 * 글자**(`;` `{` `}` `<` `>` 따옴표)는 지운다 — 값이 어디서 오는지가 나중에 바뀔 수 있고,
 * 그때 이 자리를 다시 검토하리라 기대하지 않는다.
 *
 * `{` 를 빠뜨리면 안 된다: `;` `}` 만 지우면 `red; } body { display:none` 이
 * `red  body { display:none` 으로 남아 여는 중괄호가 그대로 살아남는다.
 *
 * 빈 값이 되면 기본값으로 떨어진다.
 */
function cssValue(value: string, fallback: string): string {
  const cleaned = value.replace(/[;{}<>"']/g, '').trim()
  return cleaned === '' ? fallback : cleaned
}

/** 지금 테마의 색을 읽는다. 못 읽으면 기본값. */
export function readPalette(root: HTMLElement | null): ExtensionHtmlPalette {
  if (root === null || typeof getComputedStyle !== 'function') return FALLBACK
  const style = getComputedStyle(root)
  const pick = (token: string, fallback: string): string =>
    cssValue(style.getPropertyValue(token), fallback)
  return {
    bg: pick('--dc-bg', FALLBACK.bg),
    text: pick('--dc-text', FALLBACK.text),
    muted: pick('--dc-text-muted', FALLBACK.muted),
    border: pick('--dc-border', FALLBACK.border),
    surface: pick('--dc-surface', FALLBACK.surface),
    accent: pick('--dc-accent', FALLBACK.accent),
  }
}

/**
 * 부모가 받은 메시지가 열기 요청인가.
 *
 * **`event.source` 검사는 부르는 쪽이 한다** — 이 함수는 모양만 본다. 두 검사를 합치면
 * 시험에서 창 객체를 흉내 내야 해서 정작 모양 판정을 못 잠근다.
 */
export function isOpenRequest(data: unknown): data is ExtensionOpenRequest & { type: string } {
  if (data === null || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  if (record['type'] !== EXTENSION_OPEN_MESSAGE) return false
  if (typeof record['path'] !== 'string' || record['path'] === '') return false
  const line = record['line']
  return line === undefined || (typeof line === 'number' && Number.isInteger(line) && line > 0)
}

/**
 * 부모가 받은 메시지가 명령 요청인가. `isOpenRequest` 와 같은 관례 — 모양만 본다.
 *
 * **받는 것은 명령 id 와 대상 문자열 하나뿐이다.** 임의의 객체를 실을 수 있게 하면 확장
 * 화면이 확장에 무엇이든 보내는 일반 통로가 되고, 그것이 `extensionPayloads.ts` 가
 * 경계했던 자리다. 대상은 새 통로가 아니라 **기존 `selection` 계약**으로 흘러간다.
 */
export function isCommandRequest(data: unknown): data is ExtensionCommandRequest & { type: string } {
  if (data === null || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  if (record['type'] !== EXTENSION_COMMAND_MESSAGE) return false
  if (typeof record['commandId'] !== 'string' || record['commandId'] === '') return false
  const target = record['target']
  return target === undefined || typeof target === 'string'
}

/**
 * 부모에게 클릭을 전하는 다리. **호스트가 넣는 유일한 스크립트다.**
 *
 * 규약은 둘이다. 확장이 둘 다 안 쓰면 아무 일도 일어나지 않는다(오류가 아니다).
 *
 * - `data-open="상대경로"` (+ 선택 `data-line`) — 파일을 연다. 표 뷰의 행 클릭 규약
 *   (`extensionRowTarget.ts` 의 `file`·`line`)과 같은 모양으로 맞췄다
 * - `data-command="명령 id"` — **그 화면 주인 확장의** 명령을 돌린다 (2026-08-13 추가).
 *   같은 마디의 `data-arg` 는 **그 명령이 겨누는 것 하나**로 함께 간다 (2026-08-14 추가)
 *
 * 한 마디가 둘 다 달고 있으면 **`data-open` 이 이긴다** — 파일 열기가 되돌리기 쉬운 쪽이다.
 *
 * `targetOrigin` 이 `'*'` 인 이유: 이 문서는 opaque origin 이라 부모 주소를 특정할 수 없다.
 * **대신 받는 쪽이 `event.source` 로 이 iframe 인지 확인한다** (`ExtensionHtmlView`).
 *
 * 확장이 자기 스크립트에서 같은 메시지를 흉내 낼 수는 있다. 그래도 얻을 것이 없다 —
 * 파일 열기는 프로젝트 안이고, 명령은 **자기 확장 것만** 돈다(주인 확인은 자식이 한다,
 * `childHandlers.ts`). 확장은 어차피 `fs` 를 직접 쓸 수 있다.
 */
const BRIDGE = `
document.addEventListener('click', function (event) {
  var node = event.target;
  if (!node || typeof node.closest !== 'function') return;

  var opening = node.closest('[data-open]');
  var path = opening ? opening.getAttribute('data-open') : null;
  if (path) {
    var line = parseInt(opening.getAttribute('data-line'), 10);
    var message = { type: '${EXTENSION_OPEN_MESSAGE}', path: path };
    if (line > 0) message.line = line;
    parent.postMessage(message, '*');
    return;
  }

  var running = node.closest('[data-command]');
  var commandId = running ? running.getAttribute('data-command') : null;
  if (!commandId) return;
  var run = { type: '${EXTENSION_COMMAND_MESSAGE}', commandId: commandId };
  var arg = running.getAttribute('data-arg');
  if (arg) run.target = arg;
  parent.postMessage(run, '*');
});
`

/**
 * 확장이 아무 스타일도 안 줘도 앱처럼 보이게 하는 최소한. 확장이 덮어쓸 수 있다.
 *
 * **여기서 한 번 더 거른다.** `readPalette` 도 거르지만, 색을 넘겨받는 경로가 그것 하나라는
 * 보장이 없다 — 거르는 자리는 **값을 심는 곳**이어야 나중에 경로가 늘어도 새지 않는다.
 */
function baseStyle(raw: ExtensionHtmlPalette): string {
  const palette: ExtensionHtmlPalette = {
    bg: cssValue(raw.bg, FALLBACK.bg),
    text: cssValue(raw.text, FALLBACK.text),
    muted: cssValue(raw.muted, FALLBACK.muted),
    border: cssValue(raw.border, FALLBACK.border),
    surface: cssValue(raw.surface, FALLBACK.surface),
    accent: cssValue(raw.accent, FALLBACK.accent),
  }
  return `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 12px;
  font: 13px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: ${palette.text}; background: ${palette.bg};
}
a { color: ${palette.accent}; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 5px 8px; text-align: left; border-bottom: 1px solid ${palette.border}; }
th { position: sticky; top: 0; background: ${palette.bg}; color: ${palette.muted}; font-weight: 600; }
tbody tr:hover { background: ${palette.surface}; }
[data-open], [data-command] { cursor: pointer; }
code { background: ${palette.surface}; padding: 1px 4px; border-radius: 4px; }
.muted { color: ${palette.muted}; }
`
}

/**
 * 확장 HTML 을 격리 문서로 감싼다.
 *
 * 결과는 `code-ext://` 로 등록해 iframe `src` 에 넣는다 — `srcdoc` 에 넣으면 아래 CSP 가
 * 앱 정책에 덮여 무시된다 (머리말).
 */
export function extensionHtmlDoc(html: string, options: { palette?: ExtensionHtmlPalette } = {}): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'unsafe-inline'">
<style>${baseStyle(options.palette ?? FALLBACK)}</style>
</head><body>
${html}
<script>${BRIDGE}</script>
</body></html>`
}
