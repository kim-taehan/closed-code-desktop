import { t } from '../i18n/messages'
import { useRunHeal } from '../state/useRunHeal'
import { useRunList } from '../state/useRunList'

// 오토힐링이 무엇을 하려는지 알리는 자리 (설계 2026-08-16 §4).
//
// **`HealBanner` 와 갈라 둔다.** 저쪽은 자가 복구(연결 사다리)의 2단 승격을 그리고 *"버튼이
// 없다"* 가 그 파일의 규칙이다 — 도는 중에 손잡이를 주면 같은 조치가 두 번 나가기 때문이다.
// 여기 버튼은 **조치를 물리는 것**이라 그 규칙이 뒤집힌다. 한 파일에 두 규칙을 넣으면
// 다음 사람이 어느 쪽을 따라야 할지 알 수 없다. 겉모습(`dc-heal--banner`)만 나눠 쓴다.
//
// **판정도 구동도 여기 없다** — `useRunHeal`(시간)과 `runHeal`(문구)이 나눠 갖는다.
// 이 파일이 하는 일은 그리는 것과, 「지금은 그만」을 훅에 이어 주는 것뿐이다.
//
// ⚠️ **`useRunList` 를 여기서 한 번 더 읽는다.** 사이드바 「실행」 패널도 같은 것을 읽지만,
// 그쪽은 사이드바가 그 패널을 보여 줄 때만 마운트된다 — 오토힐링은 **사용자가 어디를 보고
// 있든** 돌아야 해서 그 수명에 얹을 수 없다 (`usePaneExits` 가 `useShellDrawer` 에 사는 것과
// 같은 판단). 정본은 앱 저장소 하나라 두 번 읽어도 갈리지 않고, 프로젝트를 옮길 때 한 번
// 더 읽는 것이 값의 전부다.

export function RunHealBanner({ projectId }: { projectId: string }): React.ReactElement | null {
  const list = useRunList(projectId)
  const heal = useRunHeal(projectId, list.entries)
  const notice = heal.notice
  if (notice === null) return null

  return (
    // `role="status"` 다 — 진행 알림이라 읽던 것을 끊지 않는다 (alert 은 끊는다)
    <div className="dc-heal dc-heal--banner" role="status">
      {/* 예고 칸에는 도는 표시가 없다. **아직 아무것도 안 돌기 때문이다** */}
      {notice.spinning && <span className="dc-spinner" aria-hidden="true" />}
      <span className="dc-heal__body">
        <span className="dc-heal__text">{notice.headline}</span>
        <span className="dc-heal__detail">{notice.detail}</span>
      </span>
      <button type="button" className="dc-heal__stop" onClick={heal.dismiss}>
        {t(notice.dismissLabel)}
      </button>
    </div>
  )
}
