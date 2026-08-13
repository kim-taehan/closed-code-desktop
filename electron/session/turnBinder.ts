// 턴 하나를 **바깥 요청과 묶어 주는 자리** (DIP 포트).
//
// 확장이 `chat.ask` 로 물으면 그 질문은 사용자 입력과 같은 통로로 나가고, 화면에도 평범한
// 턴으로 보인다. 그런데 끝났을 때 답을 물어본 쪽에 돌려줘야 한다 — 세션은 "누가 물었는지"
// 를 모르고, 알 이유도 없다.
//
// 그래서 세션은 **이 포트만 안다.** 구현은 확장 쪽(`electron/extensions/chatAsk.ts`)에 있고,
// 세션이 확장을 import 하지 않는다. 확장이 없는 실행(테스트·확장 끈 상태)에서는 아무도
// 안 꽂혀 있으면 그만이다.

export interface TurnBinder {
  /** 요청을 보냈다. 다음에 열리는 턴이 이 요청의 턴이다. */
  markPending(requestId: string): void
  /** 턴이 열렸다. 대기 중인 요청이 있으면 이 streamId 와 묶는다. */
  onStreamStart(streamId: string): void
  /** 턴이 끝났다. 묶인 요청이 있으면 이 텍스트로 답한다. */
  onStreamEnd(streamId: string, text: string): void
  /** 사용자가 끊었다. 오류가 아니라 취소로 돌려준다. */
  onCancelled(streamId: string): void
  /** 보내지도 못했다. 아직 안 묶인 요청을 사유와 함께 되돌린다. */
  rejectPending(reason: string): void
}
