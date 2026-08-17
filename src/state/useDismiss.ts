import { useEffect } from 'react'

// 열린 메뉴·팝오버를 닫는 훅. **다섯 벌이 흩어져 있던 것을 모았다** (2026-08-17):
// `SidebarPanelSelect`(export) · `AppMenu` · `ScmCommitBar` 가 `useDismissOnOutside` 를,
// `ModelSwitch` · `PermissionModeSwitch` 가 `useDismiss` 를 각자 들고 있었다.
//
// **훅이 컴포넌트 파일에서 나오고 있었다.** 넷이 `SidebarPanelSelect.tsx` 에서 import 하고
// 있었는데, 그 파일은 사이드바 선택 UI 지 훅의 집이 아니다 — 그쪽을 지우거나 옮기면
// 무관한 메뉴 넷이 함께 무너진다.
//
// ## 갈래를 둘로 **유지한다** — 합치면 리팩토링이 아니다
//
// 두 무리는 Escape 처리가 갈라져 있었고, 그것이 의도인지 흘러온 것인지 코드로는 안 보인다.
// 하나로 합치면 `AppMenu`·`ScmCommitBar`·사이드바 메뉴에 Escape 닫기가 **새로 생긴다** —
// 그건 정리가 아니라 기능 변경이라 따로 확인할 일이다. 그래서 갈래는 그대로 두고
// **이름이 그 차이를 말하게** 했다: 예전 이름(`useDismiss` vs `useDismissOnOutside`)은
// 무엇이 다른지 안 알려줘서, 부르는 쪽에서 Escape 가 걸리는지 열어 봐야 알 수 있었다.

/**
 * 바깥을 누르면 닫는다. 열려 있을 때만 듣는다.
 *
 * **`click` 이 아니라 `mousedown` 이다.** `click` 으로 걸면 메뉴를 여는 그 클릭이
 * 올라오는 순간 바깥 클릭으로 잡혀 **열자마자 닫힌다.**
 */
export function useDismissOnOutside(
  ref: React.RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return

    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, onDismiss, active])
}

/**
 * 위와 같고 **Escape 도 듣는다.** 모델·권한 스위처가 쓴다.
 *
 * Escape 는 창 전체에서 듣는다 — 메뉴가 열려 있는 동안 초점이 어디 있든 닫혀야 한다.
 */
export function useDismissOnOutsideOrEscape(
  ref: React.RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active: boolean,
): void {
  useDismissOnOutside(ref, onDismiss, active)

  useEffect(() => {
    if (!active) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDismiss, active])
}
