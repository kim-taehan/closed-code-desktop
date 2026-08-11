import { HandlerSet } from '../ws/transport'
import type { ExtensionProgressPayload } from '../../shared/ipc/extensionPayloads'

// 확장이 뷰로 올린 것들 (`view.setRows`·`setHtml`·`setTree`).
//
// 셋이 **겉봉 규칙이 같아서**(뷰 id · 값 · 어느 프로젝트 것인가) 한곳에 모았다.
// `service.ts` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았고, 기여점이 하나 늘 때마다
// 필드·구독·정리 세 자리를 같이 고쳐야 하는 것도 이쪽으로 모으는 근거다.
//
// **판단이 없다.** 누가 구독하는지도, 무엇을 그리는지도 모른다.

export class ViewEmitters {
  readonly rows = new HandlerSet<[string, unknown[], string | null]>()
  readonly html = new HandlerSet<[string, string, string | null]>()
  /**
   * 진행 상황. 겉봉 규칙은 같다 — 명령을 건 프로젝트로 간다.
   *
   * 셋과 달리 **통째 payload** 다. 뷰 id 가 없어 자리를 하나씩 늘어놓을 수 있었는데,
   * 실을 것이 다섯을 넘어서면서(글·분수·성격·레인) 자리 순서를 세 파일에서 맞춰야 했다.
   * 주인(`extension`)은 payload 안에 있다 — 진행은 뷰를 모르지만 주인은 안다.
   */
  readonly progress = new HandlerSet<[ExtensionProgressPayload, string | null]>()
  readonly tree = new HandlerSet<[string, unknown[], string | null]>()

  /**
   * `serviceDispatch` 가 받는 모양으로 묶어 준다.
   *
   * `service.ts` 가 네 줄을 손으로 잇던 자리다 — 기여점이 하나 늘 때마다 저쪽을 함께
   * 고쳐야 했고, 저쪽은 300줄 상한에 붙어 있다. 어디로 흘려보내는지는 이 파일의 관심사다.
   */
  bindings(projectId: () => string | null) {
    return {
      projectId,
      emitRows: (viewId: string, rows: unknown[], owner: string | null) => this.rows.emit(viewId, rows, owner),
      emitHtml: (viewId: string, html: string, owner: string | null) => this.html.emit(viewId, html, owner),
      emitTree: (viewId: string, nodes: unknown[], owner: string | null) => this.tree.emit(viewId, nodes, owner),
      emitProgress: (payload: ExtensionProgressPayload, owner: string | null) =>
        this.progress.emit(payload, owner),
    }
  }

  clear(): void {
    this.rows.clear()
    this.html.clear()
    this.tree.clear()
    this.progress.clear()
  }
}
