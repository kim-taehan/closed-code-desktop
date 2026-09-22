import type { OpencodeEvent } from './events'

// **세션 격리 필터.** `transport.ts` 의 `onEvent` 첫머리에 있던 것을 순수 판정으로 갈라냈다.
//
// `/event` 는 **서버 전역**이라 다른 세션의 이벤트도 흘러온다. sessionID 가 실린 이벤트는
// 우리 세션 것만 통과시킨다 — 안 거르면 다른 창의 대화가 이 화면에 섞여 렌더된다.
// davis 때는 프로젝트마다 소켓이 갈려 물리적으로 안전했던 자리라, 막는 것은 **이 함수 하나뿐**이다
// (`electron/session/multiSession.test.ts` 가 겨눈다).
//
// sessionID 가 없으면 통과시킨다(fail-open). 안전한 근거는 종료 신호(`session.idle`·`session.error`)도
// sessionID 를 싣는다는 실측이다 — 안 실었다면 남의 idle 이 내 턴을 닫는다.
//
// ⚠️ **「우리 세션」이 null 일 때 열어 두면 샌다 (2026-09-22 실측, opencode 1.18.18).**
// 예전 판정은 `this.sessionId && ...` 라 세션이 없으면 **전부** 통과시켰다. 세션은 지금 보던
// 대화를 지우면 null 이 된다(`sessionSwitch.ts` 2번 갈래). 그때 턴이 살아 있으면 남의 세션의
// `permission.asked`·`question.asked`(제 sessionID 를 싣는다 — 실측)가 **내 승인 카드로 떴다.**
// 확장이 없어도 난다 — 서브에이전트 세션처럼 한 서버에 세션은 여럿이다.
//
// 그래서 세션이 없을 때의 기준은 **살아 있는 턴이 선 세션**이다. 이것마저 없애면(= 세션이 없으면
// 전부 버리면) 대화를 지운 그 턴의 종료 신호(`session.idle`)도 버려져 턴이 영영 안 닫힌다.
// 둘 다 없으면 우리 것이라 부를 세션이 없다 — sessionID 가 실린 것은 전부 버린다.

/**
 * 이 이벤트를 이 창이 받아도 되는가.
 *
 * @param owner 지금 보는 세션, 없으면 살아 있는 턴의 세션 (`sessionId ?? turnSessionId`).
 *   둘 다 없으면 null.
 */
export function admits(event: OpencodeEvent, owner: string | null): boolean {
  const eventSession = (event.properties as Record<string, unknown> | undefined)?.['sessionID']
  if (typeof eventSession !== 'string') return true
  return eventSession === owner
}
