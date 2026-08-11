// 핸드셰이크가 ready 가 됐을 때 심는 것들.
//
// **첫 ready 와 재연결 ready 는 심는 게 다르다.** 그 차이가 이 모듈이 따로 있는 이유다.
// 두 곳에 흩어 두면 한쪽만 고쳐져서, 재연결이 조용히 대화를 끊거나 권한 모드를 잃는다.

/** 필요한 동작만 구조적으로 요구한다 — 컨트롤러 구현에 묶이지 않아야 테스트가 쉽다 */
export interface ReadyTargets {
  permission: { reapply(): void } | null
  history: { requestNewChat(): void; requestList(): void } | null
  mcp: { requestStatus(): void } | null
  llm: { requestModelOptions(): void } | null
}

/** 재연결·최초 공통 — runtime 이 세션 메모리에만 들고 있어 매번 다시 심어야 하는 것들 */
function primeSessionScoped(targets: ReadyTargets): void {
  // runtime 은 권한 모드를 세션 메모리에만 둔다 — 세션이 새로 서면 기본값으로 돌아간다
  targets.permission?.reapply()
  // 붙자마자 받아둔다. 설정 화면·입력창 툴바가 열릴 때 기다리지 않게 (DC-1322)
  targets.mcp?.requestStatus()
  targets.llm?.requestModelOptions()
}

/** 첫 ready — 세션을 새로 차린다 */
export function primeOnFirstReady(targets: ReadyTargets): void {
  primeSessionScoped(targets)
  // 새 chat_id 를 발급받아 심는다 — 세션의 모든 메시지가 이 id 를 써 한 대화 = 한 이력
  targets.history?.requestNewChat()
  targets.history?.requestList()
}

/**
 * 재연결 ready — runtime 쪽 세션이 통째로 갈아 끼워졌다.
 *
 * **새 chat_id 를 받지 않는다.** 대화는 이어지는 중이고, 여기서 새로 발급하면
 * 소켓이 한 번 끊겼다는 이유로 사용자의 대화 이력이 갈라진다.
 */
export function reprimeAfterReconnect(targets: ReadyTargets): void {
  primeSessionScoped(targets)
}
