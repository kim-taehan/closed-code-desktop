import type { ActiveTab, OpenFilesApi } from './useOpenFiles'
import { SCM_TAB } from './useScmView'

// 본문 탭 순환·닫기 — Ctrl+Tab / ⌘W 단축키와 ←·→ 제스처가 같은 경로를 쓴다.
//
// 순서는 화면의 탭 줄과 같다: 대화 → 파일들(연 순서) → 로그 → 소스 관리. 양방향 래핑.

/** 다음/이전 탭. 로그·소스 관리 탭은 열려 있을 때만 순환에 낀다. */
export function cycleTab(args: {
  active: ActiveTab
  /** 열린 파일 경로, 탭 순서대로 */
  files: readonly string[]
  logsOpen: boolean
  /** 파일이 아닌 탭이 하나 더 붙었다. 옵션인 것은 부르는 쪽 열 곳이 다 바뀌지 않게 하려는 것 */
  scmOpen?: boolean
  direction: 1 | -1
}): ActiveTab {
  const order: ActiveTab[] = [
    'chat',
    ...args.files,
    ...(args.logsOpen ? ['logs'] : []),
    ...(args.scmOpen ? [SCM_TAB] : []),
  ]
  const index = order.indexOf(args.active)
  // 모르는 탭이면 대화 기준으로 센다 — 순환이 멈추는 것보다 낫다
  const from = index < 0 ? 0 : index
  return order[(from + args.direction + order.length) % order.length]!
}

export interface TabNavigation {
  next: () => void
  prev: () => void
  /** 활성 파일/로그 탭을 닫는다. 대화 탭이면 아무 것도 안 한다 — 창을 닫지 않는다 (사용자 결정). */
  closeActive: () => void
}

/** App 이 렌더마다 부른다 — 상태가 없어 훅일 필요가 없다 */
export function tabNavigation(
  openFiles: OpenFilesApi,
  logsOpen: boolean,
  closeLogs: () => void,
  /** 소스 관리 탭. 없으면 그 탭이 없는 것으로 친다 (기존 호출부 무변경) */
  scm?: { open: boolean; close: () => void },
): TabNavigation {
  const cycle = (direction: 1 | -1) =>
    openFiles.select(
      cycleTab({
        active: openFiles.active,
        files: openFiles.files.map((file) => file.path),
        logsOpen,
        ...(scm ? { scmOpen: scm.open } : {}),
        direction,
      }),
    )

  return {
    next: () => cycle(1),
    prev: () => cycle(-1),
    closeActive: () => {
      if (openFiles.active === 'logs') {
        // MainTabs 의 로그 × 와 같은 경로 — 로그를 닫고 대화로 돌아간다
        closeLogs()
        openFiles.select('chat')
      } else if (openFiles.active === SCM_TAB) {
        // 로그와 같은 경로. 파일 탭이 아니라 openFiles.close 로는 닫히지 않는다
        scm?.close()
        openFiles.select('chat')
      } else if (openFiles.active !== 'chat') {
        openFiles.close(openFiles.active)
      }
    },
  }
}
