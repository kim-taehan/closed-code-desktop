import { APP_REJECTED_MESSAGE, APP_THEME_MESSAGE } from '../../shared/extensions/uiMessage'
import type { ExtensionHtmlPalette } from './extensionHtmlDoc'

// 웹뷰 탭(매니페스트 3판) iframe 으로 **내려보내는 쪽**의 규칙. 창 객체 없이 시험하려고 갈라 뒀다
// (`extensionHtmlDoc.ts` 가 판정을 순수 함수로 뺀 것과 같은 이유).

/**
 * iframe 이 `load` 하기 전에 온 메시지를 **붙잡아 둔다.**
 *
 * 탭을 여는 명령이 곧바로 첫 데이터를 미는 것이 흔한 모양이다 (`code.ui.open` → `code.ui.post`).
 * 그때 iframe 은 아직 문서를 받는 중이라, 바로 `postMessage` 하면 앞단의 `message` 리스너가
 * 걸리기 전이어서 **조용히 사라진다.** `load` 가 오면 쌓인 순서대로 내보낸다.
 *
 * `load` 는 여러 번 올 수 있다 (앞단이 `ui/` 안의 다른 문서로 옮겨 가면). 올 때마다 다시 연다.
 */
export class WebviewOutbox {
  private waiting: unknown[] = []
  private post: ((message: unknown) => void) | null = null

  /** 뒷단이 민 한 통. 열려 있으면 바로, 아니면 쌓는다 */
  push(message: unknown): void {
    if (this.post === null) this.waiting.push(message)
    else this.post(message)
  }

  /** `load` 가 왔다. `first` 를 먼저 보내고(테마) 쌓인 것을 순서대로 비운다 */
  open(post: (message: unknown) => void, first: unknown[] = []): void {
    this.post = post
    const queued = this.waiting
    this.waiting = []
    for (const message of [...first, ...queued]) post(message)
  }

  get isOpen(): boolean {
    return this.post !== null
  }

  /** 탭이 사라진다. 쌓인 것도 버린다 — 다시 열리는 탭은 새 앞단이다 */
  close(): void {
    this.post = null
    this.waiting = []
  }
}

/**
 * 앱 테마를 CSS 변수로 (E6). **쓸지 말지는 확장이 정한다** — 앱은 넣어 주지 않고 알리기만 한다.
 *
 * 이름은 `--app-*` 다. 앱 안쪽 이름(`--dc-*`)을 그대로 내보내면 앱 스타일시트를 고칠 때마다
 * 확장 화면이 깨진다 — 확장이 보는 이름은 계약이고 SDK(`extension-api.d.ts`)에 적힌다.
 * 값은 `readPalette` 가 이미 거른 것이다 (`;`·중괄호·따옴표 없음).
 */
export function themeMessage(palette: ExtensionHtmlPalette): { type: string; vars: Record<string, string> } {
  return {
    type: APP_THEME_MESSAGE,
    vars: {
      '--app-bg': palette.bg,
      '--app-text': palette.text,
      '--app-muted': palette.muted,
      '--app-border': palette.border,
      '--app-surface': palette.surface,
      '--app-accent': palette.accent,
    },
  }
}

/** 앞단이 올린 것을 못 건넸다 — 사유를 앞단에 돌려줄 한 통 */
export function rejectedMessage(reason: string): { type: string; reason: string } {
  return { type: APP_REJECTED_MESSAGE, reason }
}
