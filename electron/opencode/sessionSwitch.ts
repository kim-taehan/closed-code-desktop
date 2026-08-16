import { Action } from '../../shared/protocol/kinds'

// 어댑터가 붙잡고 있는 **세션 상태의 전이**. `transport.ts` 의 `onChatHistory` 에서 갈라냈다.
//
// **어댑터에서만 할 수 있는 일이다.** davis 는 `chat_id` 를 요청마다 실어 runtime 이 갈랐지만,
// opencode 에서 대화의 정체는 **세션 그 자체**라 어댑터가 붙잡고 있는 `sessionId` 를 갈아야
// 한다. 안 갈면 과거 대화를 열어 놓고 이어 말했는데 답이 원래 세션에 쌓인다 — 화면에는
// 아무 일도 안 일어난 것처럼 보인다.
//
// 봉투를 내는 일(`chatHistory.ts`)과 상태를 가는 일을 갈라 둔 이유: 저쪽은 서버와 말을 섞고
// 이쪽은 순수 전이라, 섞여 있으면 전이만 따로 재는 시험을 쓸 수 없다.

export interface SessionState {
  /** 지금 프롬프트가 나갈 세션. 없으면 null */
  sessionId: string | null
  /** 이 세션에 아직 아무 말도 안 걸었는가 */
  emptySession: boolean
}

/**
 * 「새 대화」가 **재사용해도 되는** 세션. 말을 건 뒤에는 없다.
 *
 * 핸드셰이크가 방금 만들어 둔 빈 세션이 그것이다. 여기서 null 을 주면 `chatHistory.ts` 가
 * 세션을 **또** 만들고, 연결마다 세션이 둘씩 생긴다 (`addChat` 의 ⚠️ 절 — 그러면 첫 질문이
 * 먼저 만든 세션으로 나가 격리 필터가 답을 전부 버린다).
 */
export function reusableSession(state: SessionState): string | null {
  return state.emptySession ? state.sessionId : null
}

/**
 * `chat_history` 한 건을 처리한 뒤의 세션 상태. 갈래가 셋이다.
 *
 * 1. 새 세션을 받았다(`next`) → 그리로 갈아탄다.
 * 2. **지운 것이 지금 열려 있던 대화였다 → 세션 id 를 놓는다.** 그대로 두면 다음 프롬프트가
 *    없어진 세션으로 나가고, 증상은 채팅이 404 로 죽는 것뿐이다.
 * 3. 그 외 → 그대로.
 *
 * ⚠️ 2번에서 `emptySession` 은 **건드리지 않는다.** 세션이 없으면 `reusableSession` 이
 * 어차피 null 을 주므로 값을 바꿀 이유가 없고, 여기서 바꾸면 갈래마다 상태 두 개를 다
 * 따져야 한다.
 */
export function nextSession(
  state: SessionState,
  action: string,
  data: Record<string, unknown>,
  next: string | null,
): SessionState {
  // 불러온 대화는 이미 말이 오간 것이다 — 비어 있는 것은 「새 대화」로 받은 세션뿐이다
  if (next) return { sessionId: next, emptySession: action === Action.CHAT_HISTORY_ADD }

  const removed = action === Action.CHAT_HISTORY_REMOVE ? data['chat_id'] : null
  if (removed === state.sessionId) return { sessionId: null, emptySession: state.emptySession }
  return state
}
