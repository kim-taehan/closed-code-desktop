// 확장이 준 HTML 을 **격리한 문서**로 감싼다. `<iframe srcdoc>` 에 그대로 들어간다.
//
// 왜 격리가 필수인가: 여기는 Electron renderer 다. 확장 HTML 을 그냥 붙이면 앱 화면과
// 같은 문서·같은 출처가 되고, 그 순간 확장이 앱의 DOM·저장소·`window.davis`(= main 으로 가는
// IPC 표면)에 손댈 수 있다. 확장 호스트(자식 프로세스)는 애초에 샌드박스가 아니지만
// (`hostEntry.ts` 의 `require` 가 평범한 Node require 다), **화면까지 열어 줄 이유는 없다.**
//
// 이 문서는 **`srcdoc` 이 아니라 URL 로** 실린다 (`davis-ext://`, `electron/extensions/viewHost.ts`).
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
export const EXTENSION_OPEN_MESSAGE = 'davis:extension-view-open'

/** 부모가 받는 열기 요청. 모양이 아니면 버린다 (`isOpenRequest`). */
export interface ExtensionOpenRequest {
  path: string
  /** 1-based. 없으면 파일만 연다 — 행 규약(`extensionRowTarget.ts`)과 같다. */
  line?: number
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
 * 부모에게 클릭을 전하는 다리. **호스트가 넣는 유일한 스크립트다.**
 *
 * 규약은 `data-open="상대경로"` 하나이고 `data-line` 은 선택이다 — 표 뷰의 행 클릭 규약
 * (`extensionRowTarget.ts` 의 `file`·`line`)과 같은 모양으로 맞췄다. 확장이 규약을 안 쓰면
 * 아무 일도 일어나지 않는다(오류가 아니다).
 *
 * `targetOrigin` 이 `'*'` 인 이유: 이 문서는 opaque origin 이라 부모 주소를 특정할 수 없다.
 * **대신 받는 쪽이 `event.source` 로 이 iframe 인지 확인한다** (`ExtensionHtmlView`).
 *
 * 확장이 자기 스크립트에서 같은 메시지를 흉내 낼 수는 있다. 그래도 되는 것이 하나뿐이라
 * (프로젝트 안 파일 열기) 얻을 것이 없고, 확장은 어차피 `fs` 를 직접 쓸 수 있다.
 */
const BRIDGE = `
document.addEventListener('click', function (event) {
  var node = event.target;
  if (!node || typeof node.closest !== 'function') return;
  var hit = node.closest('[data-open]');
  if (!hit) return;
  var path = hit.getAttribute('data-open');
  if (!path) return;
  var line = parseInt(hit.getAttribute('data-line'), 10);
  var message = { type: '${EXTENSION_OPEN_MESSAGE}', path: path };
  if (line > 0) message.line = line;
  parent.postMessage(message, '*');
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
[data-open] { cursor: pointer; }
code { background: ${palette.surface}; padding: 1px 4px; border-radius: 4px; }
.muted { color: ${palette.muted}; }
`
}

/**
 * 확장 HTML 을 격리 문서로 감싼다.
 *
 * 결과는 `davis-ext://` 로 등록해 iframe `src` 에 넣는다 — `srcdoc` 에 넣으면 아래 CSP 가
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
