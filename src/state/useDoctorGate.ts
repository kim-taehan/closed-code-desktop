import { useEffect, useRef, useState } from 'react'

// 진단 팝업의 **자동 게이트**.
//
// 지금까지 이 팝업에 닿는 길은 하나뿐이었다 — 사이드바 상태 배지 클릭. davis 는 프로젝트를
// 처음 열 때 설정이 비면 팝업을 띄웠고, 주석이 이유를 적었다:
// *"빈 화면 앞에서 왜 안 되는지 찾게 두지 않는다."*
//
// **opencode 에서는 그 상태가 davis 보다 더 흔하다.** 사용자가 `opencode serve` 를 **먼저
// 쳐야** 하기 때문이다 (`README.md`). davis 는 앱이 런타임을 띄웠으므로 "안 떠 있는 첫 실행"
// 이 예외였지만, opencode 에서는 **그게 기본값이다.**
//
// 판정을 `App` 이 아니라 여기서 하는 이유: `AppDialogs` 가 `status`·`project` 를 **이미 받고
// 있어** 위로 끌어올릴 것이 없다. `App.tsx` 는 한 줄도 안 고친다.

export interface DoctorGate {
  open: boolean
  close: () => void
}

/**
 * **자가 복구가 최종 실패했을 때만 연다** (`failed` — `useAutoHeal` 이 낸 판정).
 *
 * 여는 조건이 **`status === 'error'` 였다.** 표는 이랬고, 그 판단 자체는 지금도 옳다:
 *
 * | 상태 | 뜻 | 그때 열었나 |
 * |---|---|---|
 * | `idle` | **아직 안 붙어 봤다** — 세션 자체가 없다 (지연 연결의 기본) | ❌ |
 * | `error` | 붙어 보고 **실패했다** (`handshake.stage === 'failed'`) | ✅ |
 * | `disconnected` | 붙었다가 끊겨 **재연결이 도는 중** | ❌ |
 *
 * *"`idle` 에서 열면 첫 렌더마다 팝업이 뜬다"*·*"재연결 중에 튀어나오는 팝업은 방해다"* —
 * 둘 다 유효하다. 바뀐 것은 **`error` 가 더 이상 끝이 아니라는 점**이다: 이제 앱이
 * 사다리를 한 바퀴 타 보고(재연결 → 서버 되살리기 → 재연결) 그래도 안 되면 그때 연다.
 * `error` 에서 곧바로 열면 **가볍게 복구될 것에도 창이 뜬다** — 설계 §3 의 2단 승격이
 * 막으려는 것이 정확히 그것이다 (상태줄 → 배너 → 창).
 *
 * **프로젝트당 한 번만 연다.** 매번 뜨면 서버를 일부러 안 띄운 사용자에게 방해이고,
 * 방해가 되면 그 화면을 아예 안 보게 되어 정작 필요할 때 못 쓴다.
 *
 * 프로젝트를 바꾸면 **저절로 닫힌다** — 연 대상(`openFor`)과 지금 보는 프로젝트가 다르면
 * 열린 것으로 치지 않는다. A 를 진단하다 B 로 옮겼는데 A 의 팝업이 B 위에 남아 있으면,
 * 그 화면이 **어느 프로젝트 것인지 알 수 없는 상태**가 된다.
 *
 * ⚠️ **`failed` 가 풀렸다고 닫지 않는다.** 주기 재측정이 도는 동안 판정은 오갈 수 있는데,
 * 그때 닫아 버리면 이미 "한 번 열었다" 로 표시돼 **다시 안 열린다.**
 * 닫는 것은 사용자(`close`)와 진단 성공(`onHealthy`) 둘뿐이다.
 */
export function useDoctorGate(projectId: string | undefined, failed: boolean): DoctorGate {
  /** 이미 자동으로 열어 본 프로젝트들. 닫아도 지워지지 않는다 — 그래서 한 번만 뜬다. */
  const shown = useRef(new Set<string>())
  const [openFor, setOpenFor] = useState<string | null>(null)

  useEffect(() => {
    if (projectId === undefined) return
    if (!failed) return
    if (shown.current.has(projectId)) return
    shown.current.add(projectId)
    setOpenFor(projectId)
  }, [projectId, failed])

  return {
    open: openFor !== null && openFor === projectId,
    close: () => setOpenFor(null),
  }
}
