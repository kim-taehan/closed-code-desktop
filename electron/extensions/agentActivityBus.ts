// 어시스턴트가 **답하는 도중의 활동**을 확장에 배달하는 표.
//
// `davisApi.ts` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았고, 자리도 여기가 맞다:
// 저쪽은 **확장이 부를 수 있는 것**(계약)이고 이쪽은 **밖에서 들어온 것을 누구에게
// 주는가**(배달)다.
//
// 왜 모듈 수준의 표인가: 통지는 `hostEntry` 의 포트 **하나**로 들어오는데 `DavisApi` 는
// **확장마다** 따로 만들어진다. 어딘가 한 곳에 배달표가 있어야 한다.
//
// **`electron` 을 import 하지 않는다** — 자식(utilityProcess) 안에서 돈다.

/**
 * 답을 만드는 동안 지나가는 것 한 조각 (`agentLane/askAgent.ts` 가 만든다).
 *
 * `kind` 를 문자열로 두는 이유: runtime 이 청크 종류를 늘리면 좁은 유니온은 여기서 막힌다.
 * 모르는 종류를 조용히 버리는 것보다 **그대로 흘려** 화면이 어떻게 그릴지 정하게 둔다.
 */
export interface AgentActivity {
  kind: string
  text: string
}

/**
 * 확장 이름 → 지금 활동을 기다리는 사람들. 하나하나가 `ask` 한 번의 수명만큼만 산다.
 *
 * **자리가 하나가 아니라 집합이다.** 확장이 질의를 겹쳐 돌리면(`extensions/test-scenario`
 * 의 `LANES`) 한 확장 안에서 `ask` 가 여럿 동시에 산다. 자리가 하나면 나중 질의가 앞
 * 질의의 등록을 밀어내고, 그 나중 질의가 먼저 끝나면 **아직 넷이 도는데 진행 줄이
 * 꺼진다** — 사용자는 멈춘 것으로 읽는다.
 */
const listeners = new Map<string, Set<(activity: AgentActivity) => void>>()

/**
 * 이 확장의 활동을 받겠다고 등록한다. 돌려주는 함수를 부르면 거둔다.
 *
 * **반드시 거둔다** (`finally`). 안 거두면 이미 끝난 질의의 자리로 활동이 계속 흘러간다.
 */
export function listenAgentActivity(
  extension: string,
  listener: (activity: AgentActivity) => void,
): () => void {
  const bag = listeners.get(extension) ?? new Set()
  bag.add(listener)
  listeners.set(extension, bag)
  return () => {
    bag.delete(listener)
    // 빈 집합을 남기지 않는다 — 확장이 뜨고 지는 동안 표가 계속 자란다
    if (bag.size === 0) listeners.delete(extension)
  }
}

/**
 * 부모가 보낸 활동 통지를 그 확장에 배달한다. 기다리는 사람이 없으면 아무 일도 안 한다.
 *
 * 받는 쪽이 던져도 삼킨다 — **곁가지 하나 때문에 확장 호스트가 죽으면** 그 순간 도는
 * 명령이 통째로 날아간다. 활동은 보여 주기용이고 산출물이 아니다.
 */
export function deliverAgentActivity(extension: string, activity: AgentActivity): void {
  // 겹쳐 도는 질의들의 활동은 **어느 것에서 온 것인지 갈라지지 않는다** — 통지에 질의를
  // 가리키는 표식이 없다. 그래서 기다리는 사람 전부에게 준다: 화면은 「지금 이것」 한 줄만
  // 그리므로 마지막에 온 소식이 남는다. 갈라야 할 일이 생기면 그때 표식을 단다.
  for (const listener of [...(listeners.get(extension) ?? [])]) {
    try {
      listener(activity)
    } catch {
      // 곁가지다
    }
  }
}
