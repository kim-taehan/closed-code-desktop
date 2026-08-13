// 확장이 채팅으로 물은 것을 되찾는 장부.
//
// 확장의 `chat.ask` 는 **사용자 입력과 같은 통로**로 나간다 (설계 2026-08-13). 그러면
// 화면에는 평범한 턴으로 보이는데, 끝났을 때 그 답을 물어본 확장에게 돌려줄 방법이 필요하다.
// 이 장부가 그 짝을 맞춘다.
//
// **짝을 맞추는 열쇠는 `streamId` 다.** 확장 요청이 나갈 때는 아직 streamId 가 없다 —
// 어댑터가 `chat_request` 를 받은 뒤에 만든다(`electron/opencode/transport.ts`). 그래서 두 걸음이다:
//
//   1. `markPending(requestId)`  — 보냈다. 아직 어느 턴인지 모른다
//   2. `onStreamStart(streamId)` — 그 다음에 열린 턴이 곧 그 요청의 턴이다 (턴은 직렬이다)
//
// 이 "다음 턴이 곧 그 턴" 이 성립하는 이유는 **큐가 하나**이기 때문이다. 확장 요청도
// 사용자 입력과 같은 렌더러 큐를 타므로, 보낸 순서대로 한 번에 하나씩 열린다.
// 큐를 하나 더 만들면 이 가정이 깨진다 (계획서 1단계의 안 B 를 버린 이유).

export type AskResult =
  | { status: 'done'; text: string }
  | { status: 'cancelled' }
  | { status: 'rejected'; reason: string }

export class ChatAskBook {
  private readonly waiting = new Map<string, (result: AskResult) => void>()
  /** 보냈지만 아직 턴이 안 열린 요청. 한 번에 하나다 — 큐가 직렬이라 둘일 수 없다. */
  private pending: string | null = null
  /** streamId → requestId. 턴이 열리면서 묶인다. */
  private readonly bound = new Map<string, string>()

  /** 확장이 기다릴 promise. 해결은 아래 세 경로 중 하나로만 일어난다. */
  ask(requestId: string): Promise<AskResult> {
    return new Promise((resolve) => {
      this.waiting.set(requestId, resolve)
    })
  }

  /** 요청을 큐에 넣었다. 다음에 열리는 턴이 이 요청의 턴이다. */
  markPending(requestId: string): void {
    this.pending = requestId
  }

  /**
   * 턴이 열렸다. 대기 중인 확장 요청이 있으면 그 턴과 묶는다.
   *
   * 대기 중인 것이 없으면 **아무 일도 하지 않는다** — 사용자가 직접 보낸 턴이다.
   */
  onStreamStart(streamId: string): void {
    if (this.pending === null) return
    this.bound.set(streamId, this.pending)
    this.pending = null
  }

  /** 턴이 끝났다. 확장 턴이면 그 답으로 푼다. */
  onStreamEnd(streamId: string, text: string): void {
    this.settle(streamId, { status: 'done', text })
  }

  /** 사용자가 끊었다. **예외가 아니다** — 확장은 정상적으로 취소를 받는다. */
  onCancelled(streamId: string): void {
    this.settle(streamId, { status: 'cancelled' })
  }

  /**
   * 보내지도 못했다 (세션 없음 등). 아직 턴이 안 열린 요청을 되돌린다.
   *
   * 묶인 것은 건드리지 않는다 — 이미 도는 턴은 제 경로로 끝난다.
   */
  rejectPending(reason: string): void {
    if (this.pending === null) return
    const requestId = this.pending
    this.pending = null
    this.resolve(requestId, { status: 'rejected', reason })
  }

  /**
   * 남은 것을 전부 되돌린다 — 확장 호스트가 죽거나 프로젝트가 닫힐 때.
   *
   * 안 하면 확장 쪽 promise 가 영영 매달린다. 호스트를 다시 띄워도 그 약속은 못 지킨다.
   */
  disposeAll(reason: string): void {
    // resolver 를 먼저 손에 쥔 뒤에 비운다 — 비우고 나면 풀 방법이 없다
    const resolvers = [...this.waiting.values()]
    this.waiting.clear()
    this.pending = null
    this.bound.clear()
    for (const resolve of resolvers) resolve({ status: 'rejected', reason })
  }

  /** 기다리는 것이 있는가. 배선 쪽에서 "확장 턴인가" 를 물을 때 쓴다. */
  get size(): number {
    return this.waiting.size
  }

  private settle(streamId: string, result: AskResult): void {
    const requestId = this.bound.get(streamId)
    // 묶이지 않은 턴 = 사용자 턴이다. 남의 턴이 끝났다고 확장의 약속을 풀면 안 된다.
    if (requestId === undefined) return
    this.bound.delete(streamId)
    this.resolve(requestId, result)
  }

  private resolve(requestId: string, result: AskResult): void {
    const resolver = this.waiting.get(requestId)
    if (!resolver) return
    this.waiting.delete(requestId)
    resolver(result)
  }
}
