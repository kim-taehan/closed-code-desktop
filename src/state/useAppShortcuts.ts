import { sendReviewDecision } from './activeReview'
import { useShortcuts } from './useShortcuts'
import type { ReviewShortcutTarget } from './activeReview'

// 창 전체 단축키를 **앱 상태에 잇는** 자리. `App.tsx` 에서 뽑아 왔다 (그 파일이 300줄
// 상한에 닿았다). 판단은 하나도 안 옮겼고 배선만 왔다 — `electron/mcp/appWiring.ts` 가
// `main.ts` 에서 갈라져 나온 것과 같은 결이다.
//
// **키가 무엇을 하는지는 여전히 `useShortcuts.ts` 가 정한다.** 여기 있는 것은 "그 행동이
// 앱의 어느 함수인가" 뿐이다 — 임자 판정(누구의 키인가)을 여기로 옮겨 오지 마라
// (`useShortcuts.ts` 머리말의 표).

export interface AppShortcutDeps {
  /** 없으면 전부 끈다 — 눌러도 아무 일이 없으면 사용자가 자기 탓으로 여긴다 */
  activeProjectId: string | null
  streaming: boolean
  /** ⌘L(로그 보기)은 개발자 모드에서만 — ⚙ 메뉴와 **같은 조건**이어야 한다 */
  developerMode: boolean
  openPalette: (kind: 'quickOpen' | 'search') => void
  openSettings: () => void
  openLogs: () => void
  /** 본문 탭 순환·닫기 (`tabCycle.ts`) */
  nav: { closeActive: () => void; next: () => void; prev: () => void }
  /** 프로젝트 탭 전환 (`projectCycle.ts`) */
  projectNav: { next: () => void; prev: () => void; at: (index: number) => void }
  shell: { goDown: () => void; goUp: () => void }
  /** ⌘Enter 가 겨눌 리뷰 카드 하나. 위에 뜬 창이 있으면 부르는 쪽이 이미 null 로 만든다 */
  reviewTarget: ReviewShortcutTarget | null
  canAcceptReview: boolean
}

export function useAppShortcuts(deps: AppShortcutDeps): void {
  useShortcuts(
    {
      onQuickOpen: () => deps.openPalette('quickOpen'),
      onSearch: () => deps.openPalette('search'),
      onNewChat: () => void window.davis.resetChat(),
      onSettings: deps.openSettings,
      // 크롬식 탭 조작. 닫을 탭이 없으면(대화만) 무시 — 창을 닫지 않는다 (사용자 결정)
      onCloseTab: () => deps.nav.closeActive(),
      onNextTab: () => deps.nav.next(),
      onPrevTab: () => deps.nav.prev(),
      onNextProject: deps.projectNav.next,
      onPrevProject: deps.projectNav.prev,
      onProjectAt: deps.projectNav.at,
      onShellDown: deps.shell.goDown,
      onShellUp: deps.shell.goUp,
      onCancelTurn: () => void window.davis.cancelChat(),
      onAcceptReview: () => {
        const target = deps.reviewTarget
        if (target) sendReviewDecision(target.review.turnId, 'accept')
      },
      ...(deps.developerMode ? { onLogs: deps.openLogs } : {}),
    },
    // 넷 다 프로젝트가 있어야 뜻이 있다 (설정 창도 프로젝트 라이선스를 다룬다).
    deps.activeProjectId !== null,
    { streaming: deps.streaming, canAcceptReview: deps.canAcceptReview },
  )
}
