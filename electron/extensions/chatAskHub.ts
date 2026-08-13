import { randomUUID } from 'node:crypto'
import { ChatAskBook, type AskResult } from './chatAsk'

// 확장의 `chat.ask` 를 프로젝트별로 관리한다.
//
// **장부는 프로젝트마다 하나다.** 장부의 `pending` 은 슬롯이 하나뿐이라 — "다음에 열리는
// 턴이 그 요청의 턴" 이라는 규칙이 그렇게만 성립한다 — 두 프로젝트가 한 장부를 나눠 쓰면
// A 의 요청이 B 의 턴에 묶인다. 세션도 프로젝트마다 하나이므로 자연스럽게 짝이 맞는다.
//
// 이 허브가 하는 일은 셋뿐이다: 요청 등록 · 렌더러에 밀어 넣기 · 세션에 꽂을 포트 내주기.

/** 요청을 화면 쪽 대기열로 밀어 넣는다. 창이 없으면 false — 그러면 요청은 거절된다. */
export type DispatchToChat = (projectId: string, payload: { requestId: string; query: string }) => boolean

export class ChatAskHub {
  private readonly books = new Map<string, ChatAskBook>()

  constructor(private readonly dispatch: DispatchToChat) {}

  /**
   * 확장이 물었다. 사용자 입력과 **같은 큐**로 밀어 넣고 답을 기다린다.
   *
   * 열린 프로젝트가 없으면 곧바로 거절한다 — 어느 대화에 넣을지 정할 수 없다.
   */
  ask(projectId: string | null, query: string): Promise<AskResult> {
    if (!projectId) {
      return Promise.resolve({ status: 'rejected', reason: '열린 프로젝트가 없습니다' })
    }
    const book = this.bookFor(projectId)
    const requestId = randomUUID()
    const waiting = book.ask(requestId)

    // 밀어 넣지 못하면(창이 없다) 기다리게 두지 않는다 — 확장이 영영 매달린다
    if (!this.dispatch(projectId, { requestId, query })) {
      book.markPending(requestId)
      book.rejectPending('채팅 화면이 없어 보내지 못했습니다')
    }
    return waiting
  }

  /** 세션에 꽂을 포트. `ChatSession` 은 이 모양(`TurnBinder`)만 안다. */
  bookFor(projectId: string): ChatAskBook {
    const existing = this.books.get(projectId)
    if (existing) return existing
    const created = new ChatAskBook()
    this.books.set(projectId, created)
    return created
  }

  /** 프로젝트를 닫거나 확장 호스트가 죽었다 — 그 프로젝트의 약속을 전부 되돌린다. */
  dispose(projectId: string, reason: string): void {
    this.books.get(projectId)?.disposeAll(reason)
    this.books.delete(projectId)
  }

  /** 앱을 끄거나 호스트를 통째로 다시 띄운다. */
  disposeAll(reason: string): void {
    for (const book of this.books.values()) book.disposeAll(reason)
    this.books.clear()
  }
}
