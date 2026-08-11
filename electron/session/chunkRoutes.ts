import { ChunkType, ALL_CHUNK_TYPES } from '../../shared/protocol/chunkTypes'

// 설계 §5 매핑표의 코드판. **이 표가 "무엇이 화면에 뜨는가"의 유일한 정본이다.**
//
// 선행 시도(desktop2)의 "지맘대로 보여주고 안 보여주고"는 드롭이 있어서가 아니라
// 드롭 기준을 그때그때 새로 정해서 생겼다. 여기 없는 타입은 렌더 규칙을 지어내지 않는다.
//
// 표를 바꾸려면 vscode 를 다시 읽고 설계 §5 를 먼저 고친 뒤 여기를 고친다.

export const ChunkRoute = {
  /** 새 메시지를 만든다 — 화면에 새 요소가 생긴다 */
  RENDERS: 'renders',
  /** 기존 메시지에 접힌다 — 새 DOM 은 없지만 기존 요소가 바뀐다 */
  FOLDS: 'folds',
  /** 턴 메타만 갱신한다 — 메시지 배열을 건드리지 않는다 */
  META_ONLY: 'meta_only',
  /** 메시지 배열 밖의 인터럽트 경로 (승인 카드 등) */
  INTERRUPT: 'interrupt',
  /** 서브에이전트 작업으로 접힌다 — 최상위 메시지가 되지 않는다 */
  SUB_AGENT: 'sub_agent',
  /** vscode 는 렌더하지만 M1 비목표라 아직 안 한다 */
  DEFERRED: 'deferred',
  /** vscode 도 렌더하지 않는다 */
  DROPPED: 'dropped',
} as const

export type ChunkRoute = (typeof ChunkRoute)[keyof typeof ChunkRoute]

/**
 * 청크 타입 → 처리 경로. **모든 ChunkType 이 반드시 여기 있어야 한다.**
 * Record 타입이라 타입 하나를 빠뜨리면 컴파일이 실패한다 — 그게 1차 방어선이다.
 */
export const CHUNK_ROUTES: Record<ChunkType, ChunkRoute> = {
  // 화면에 새 요소를 만든다 (설계 §5.1)
  [ChunkType.TEXT]: ChunkRoute.RENDERS,
  // DC-1029/1030 추론 토큰. 접힌 버블을 만든다 — 답변과 섞이면 안 되므로 별도 kind 다.
  [ChunkType.THINKING]: ChunkRoute.RENDERS,
  [ChunkType.TOOL_CALL]: ChunkRoute.RENDERS,
  [ChunkType.ERROR]: ChunkRoute.RENDERS,
  // 구버전 이력에만 존재하는 실패 청크 (chunkTypes.ts 의 AGENT_ERROR 주석에 근거).
  // error 와 같은 취급 — 실패한 턴은 이력 재생에서도 화면에 남아야 한다.
  [ChunkType.AGENT_ERROR]: ChunkRoute.RENDERS,

  // 기존 메시지에 접힌다 (설계 §5.2)
  [ChunkType.TOOL_RESULT]: ChunkRoute.FOLDS,
  [ChunkType.TYPE_REVISION]: ChunkRoute.FOLDS,

  // 턴 메타만 (설계 §5.2)
  [ChunkType.TURN_START]: ChunkRoute.META_ONLY,
  [ChunkType.TURN_END]: ChunkRoute.META_ONLY,

  // 인터럽트 경로 — 메시지 배열에 들어가지 않는다 (설계 §6.3)
  [ChunkType.TOOL_APPROVAL_REQUEST]: ChunkRoute.INTERRUPT,
  // HIL — 답하지 않으면 턴이 그 자리에서 멈춘다 (ask_user·propose_plan, DC-644/776)
  [ChunkType.USER_QUESTION]: ChunkRoute.INTERRUPT,
  [ChunkType.PLAN_APPROVAL]: ChunkRoute.INTERRUPT,

  // 서브에이전트 작업 (M3). 최상위 메시지가 아니라 작업 카드에 접힌다.
  [ChunkType.AGENT_TASK_START]: ChunkRoute.SUB_AGENT,
  [ChunkType.AGENT_TASK_END]: ChunkRoute.SUB_AGENT,

  // runtime 이 kind=diff 로 재라우팅하므로 채팅 경로로는 오지 않는다 (설계 §4.4).
  //
  // 근거 — runtime `services/event_sink/websocket_sink.py` `on_stream_chunk()` 를 직접 확인:
  //   :53  `isinstance(msg, CodeDiffMessage)` 가 **첫 분기**다. 아래 어느 갈래든 return 한다.
  //   :57  worktree 활성이면 아예 발행하지 않는다 (DC-777)
  //   :60  그 외는 `_route_to_diff_engine()`(:110) → :126 이 DiffService 로 넘긴다 →
  //        `app/diff_engine/rpc/handlers.py:155 parse_and_send_code_diff` → :250 `kind=Kind.DIFF`
  //   :144 DiffService 가 없거나(:136) 예외가 나면(:140) 폴백 `_fallback_send` — 이쪽도
  //        :150 `kind=Kind.DIFF`, `action=diff_parse`, `messageType=apply_file_content`
  //        → **chat 청크로 새는 갈래가 없다**
  //   :72  JSONL 영속화(`add_message`)는 이 분기보다 **뒤**에 있다 → 이력에도 남지 않아
  //        재생 경로로도 오지 않는다
  // 생산 지점은 `agent/event_processor.py` 의 diff 도구 결과 하나뿐이고 전부 이 sink 를 지난다.
  //
  // 따라서 이 DEFERRED 는 "아직 안 만든 기능"이 아니라 **도달 불가 경로**다.
  // 가짜 런타임에 code_diff 대본을 넣어 재생하면 runtime 이 보내지 않는 것을
  // 보낼 수 있다고 거짓 입증하게 되므로 만들지 않는다.
  [ChunkType.CODE_DIFF]: ChunkRoute.DEFERRED,

  // vscode 도 렌더하지 않는다
  [ChunkType.SYSTEM]: ChunkRoute.DROPPED,
}

/** 표에 있는 타입인가. 없으면 "표의 누락"이며 렌더 규칙을 지어내지 않는다 (설계 §5.3). */
export function routeOf(messageType: string): ChunkRoute | undefined {
  return (CHUNK_ROUTES as Record<string, ChunkRoute>)[messageType]
}

/** 화면에 새 요소를 만드는 타입인가 — 전수 테스트가 이 기준으로 양쪽을 단언한다. */
export function producesMessage(route: ChunkRoute): boolean {
  return route === ChunkRoute.RENDERS
}

/** 서브에이전트 작업으로 흘러가는 경로인가 */
export function isSubAgentRoute(route: ChunkRoute): boolean {
  return route === ChunkRoute.SUB_AGENT
}

/** 표에 실린 모든 타입. 전수 테스트가 이 목록을 순회한다. */
export const ROUTED_CHUNK_TYPES: readonly ChunkType[] = ALL_CHUNK_TYPES
