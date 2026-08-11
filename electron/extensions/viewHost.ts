// 확장 화면을 **URL 로** 서빙한다. `davis-ext://view/<토큰>`.
//
// 왜 `srcdoc` 이 아니라 이것인가 — 실측으로 밝혀진 이유가 하나뿐이다:
//
//   **`srcdoc` 문서는 부모(앱)의 CSP 를 물려받는다.** `index.html` 의 정책은
//   `default-src 'self'` (script-src 없음 → 여기로 떨어짐)라 **인라인 스크립트가 금지**된다.
//   CSP 는 여러 정책이 겹치면 가장 빡빡한 쪽이 이기므로, 문서 안에 `script-src` 를 아무리
//   적어도 소용이 없다. 증상이 이 진단과 정확히 맞았다 — 앱 정책의 `style-src` 에는
//   `'unsafe-inline'` 이 있어 **표 스타일은 나왔고 클릭 다리만 죽었다.**
//
// URL 로 실린 문서는 **정책을 물려받지 않는다.** 자기 문서의 `<meta>` CSP 가 정본이 된다
// (`src/state/extensionHtmlDoc.ts` 가 만든다 — 정책을 만드는 곳은 거기 하나다).
//
// 격리는 그대로다: `sandbox="allow-scripts"`(allow-same-origin 없음 → opaque origin) +
// 문서 CSP 의 `default-src 'none'`(바깥 네트워크 차단).
//
// **앱 CSP 를 푸는 길은 택하지 않았다.** 확장 하나 때문에 앱 전체의 XSS 방어를 여는 것이라
// 값이 맞지 않는다.

/** iframe 이 쓰는 스킴. `main.ts` 가 privileged 로 등록하고 `index.html` 이 frame-src 로 허용한다. */
export const VIEW_SCHEME = 'davis-ext'

/**
 * 들고 있을 문서 수.
 *
 * 화면을 다시 그릴 때마다 새 토큰이 생기고 앞엣것은 죽는다. 안 비우면 훑기를 반복할수록
 * 수백 KB 짜리 문서가 계속 쌓인다. 열려 있는 확장 탭이 동시에 여럿일 수 있어 1 로는 부족하다.
 */
const MAX_DOCS = 16

export class ExtensionViewHost {
  private readonly docs = new Map<string, string>()
  private next = 0

  /**
   * 문서를 등록하고 iframe 에 넣을 URL 을 돌려준다.
   *
   * 토큰은 **부를 때마다 새로 만든다.** 같은 토큰을 재사용하면 내용이 바뀌어도 브라우저가
   * 캐시된 문서를 그대로 보여줘, 명령을 다시 돌려도 화면이 안 바뀐다.
   */
  register(doc: string): string {
    this.next += 1
    const token = String(this.next)
    this.docs.set(token, doc)
    // Map 은 넣은 순서를 지킨다 — 가장 오래된 것부터 버린다
    while (this.docs.size > MAX_DOCS) {
      const oldest = this.docs.keys().next().value
      if (oldest === undefined) break
      this.docs.delete(oldest)
    }
    return `${VIEW_SCHEME}://view/${token}`
  }

  /**
   * `protocol.handle` 이 부르는 처리기.
   *
   * 모르는 토큰은 **404 로 답한다.** 빈 200 을 주면 화면이 하얗게만 뜨고 사유가 안 남는다 —
   * 오래돼 버려진 것인지 배선이 끊긴 것인지 구분되지 않는다.
   */
  handle(url: string): { status: number; body: string } {
    const token = tokenOf(url)
    const doc = token === null ? undefined : this.docs.get(token)
    if (doc === undefined) {
      return { status: 404, body: '<!doctype html><meta charset="utf-8">만료된 확장 화면입니다.' }
    }
    return { status: 200, body: doc }
  }

  dispose(): void {
    this.docs.clear()
  }
}

/** `davis-ext://view/12` → `12`. 모양이 아니면 null. */
function tokenOf(url: string): string | null {
  const matched = /^davis-ext:\/\/view\/([^/?#]+)/.exec(url)
  return matched === null ? null : (matched[1] as string)
}
