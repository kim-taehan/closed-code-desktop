// 확장 호스트(자식) 안에서 **웹뷰 앞단 → 뒷단** 메시지를 받을 처리기들 (`code.ui.onMessage`).
//
// 자식은 확장 전부를 한 프로세스에 싣는다. 그래서 처리기를 (확장 · 뷰)로 갈라 두지 않으면
// 확장 A 의 화면이 보낸 것을 확장 B 가 받는다. 확장 이름은 확장이 말하지 않는다 —
// `createExtensionApi` 가 **어느 확장에 준 `code` 인지** 알고 채운다 (`storage` 와 같은 규칙).
//
// 싣기를 다시 하면(`host.loadExtensions`) 비운다 (`childHandlers.ts`). 안 비우면 `activate` 가
// 다시 돌 때마다 같은 처리기가 한 벌씩 쌓여 메시지 하나에 여러 번 답한다.
//
// **electron 을 import 하지 않는다** — 자식에서 돈다 (`rpc.ts` 머리말).

/** 앞단이 보낸 것과 **어느 프로젝트의 탭에서 왔는지.** 답을 그 탭에 되돌리는 데 쓴다 */
export type UiMessageHandler = (message: unknown, context: { projectId: string }) => unknown

export class UiHandlers {
  private readonly byView = new Map<string, UiMessageHandler[]>()

  /** 처리기를 건다. 돌려준 함수를 부르면 뗀다 */
  add(extension: string, viewId: string, handler: UiMessageHandler): () => void {
    const key = keyOf(extension, viewId)
    this.byView.set(key, [...(this.byView.get(key) ?? []), handler])
    return () => {
      const left = (this.byView.get(key) ?? []).filter((one) => one !== handler)
      if (left.length === 0) this.byView.delete(key)
      else this.byView.set(key, left)
    }
  }

  /**
   * 한 통을 그 (확장 · 뷰)의 처리기에 준다. **받을 처리기가 없으면 던진다** —
   * 조용히 삼키면 확장 화면은 보냈는데 아무 일도 안 일어나는 것으로만 보인다.
   * 앞단은 그 사유를 `__app:rejected` 로 받는다 (`shared/extensions/uiMessage.ts`).
   *
   * 처리기가 여럿이면 차례로 기다린다 — 겉봉(`ProjectEnvelope`)은 이 일이 끝날 때까지 서 있고,
   * 그 사이 확장이 부른 `code.ui.post` 가 같은 프로젝트로 간다.
   */
  async deliver(extension: string, viewId: string, message: unknown, projectId: string): Promise<void> {
    const handlers = this.byView.get(keyOf(extension, viewId)) ?? []
    if (handlers.length === 0) throw new Error(`${extension} 확장이 ${viewId} 화면의 메시지를 받지 않습니다 (code.ui.onMessage)`)
    for (const handler of handlers) await handler(message, { projectId })
  }

  clear(): void {
    this.byView.clear()
  }
}

/** 확장 이름과 뷰 id 둘 다 남의 문자열이라 구분자로 잇지 않는다 */
function keyOf(extension: string, viewId: string): string {
  return JSON.stringify([extension, viewId])
}
