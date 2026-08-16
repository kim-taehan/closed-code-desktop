import type { HealNotice } from '../state/healNotice'

// 자가 복구가 무엇을 하는지 알리는 자리 — **2단 승격의 화면 쪽**이다 (설계 2026-08-16 §3).
//
//   상태줄  ①만 도는 동안. 한 줄, 근거 없음, 버튼 없음 — 가볍게 복구되면 모르고 지나간다
//   배너    ② 이상. 무거운 조치는 알린다 — 근거가 함께 붙는다
//
// **버튼이 없다.** 도는 중에 손잡이를 주면 그 조치가 사다리와 겹친다 (같은 재연결·재시작이
// 두 번 나간다). 사용자가 개입할 자리는 최종 실패 뒤 저절로 열리는 Doctor 창이다.
//
// 문구는 여기서 만들지 않는다. `state/healNotice.ts` 가 정한 것을 그대로 그린다 —
// 판정을 순수하게 두면 구동자를 main 으로 옮길 때 이 파일만 남기고 갈 수 있다 (§4).
//
// `stage: 'doctor'` 는 아무것도 안 그린다. 그 칸의 표시 수단은 **Doctor 창 자체**이고,
// 창이 뜬 위에 같은 말을 또 얹으면 두 번 말하는 것이 된다.

export function HealBanner({ notice }: { notice: HealNotice | null }) {
  if (notice === null || notice.stage === 'doctor') return null

  if (notice.stage === 'statusline') {
    // `role="status"` 다 — 진행 알림이라 읽던 것을 끊지 않는다 (alert 은 끊는다)
    return (
      <div className="dc-heal dc-heal--line" role="status">
        <span className="dc-spinner" aria-hidden="true" />
        <span className="dc-heal__text">{notice.headline}</span>
      </div>
    )
  }

  return (
    <div className="dc-heal dc-heal--banner" role="status">
      <span className="dc-spinner" aria-hidden="true" />
      <span className="dc-heal__body">
        <span className="dc-heal__text">{notice.headline}</span>
        {notice.detail && <span className="dc-heal__detail">{notice.detail}</span>}
      </span>
    </div>
  )
}
