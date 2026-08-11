import type { ProjectRecord } from '../../shared/projects/projectRecord'
import type { ProjectsApi } from './useProjects'

// 프로젝트 탭 전환 — **⌘/Ctrl + Alt + ←·→** (순환) 과 **⌘/Ctrl + 1..9** (직행) 이 쓴다.
//
// ⚠️ 예전 주석은 "⌘/Ctrl + ←·→" 라고 적고 있었는데 **틀렸다** — 실제 등록은
// `useShortcuts.ts:73` 이고 **Alt 가 필수**다. 맨 ⌘←→ 를 안 쓰는 이유는 그 자리 주석에
// 있다: 입력창·코드 편집기에서 줄 처음/끝 이동이라 뺏으면 타이핑이 망가진다.
//
// 순서는 화면의 프로젝트 탭 줄과 같다 (projectRegistry 가 연 순서 그대로 준다).
// 본문 탭(tabCycle.ts)과 마찬가지로 양쪽으로 래핑한다.

/** 다음/이전 프로젝트 id. 옮겨 갈 곳이 없으면 null — 탭이 하나뿐이거나 활성이 없을 때다. */
export function cycleProject(
  open: readonly ProjectRecord[],
  activeId: string | null,
  direction: 1 | -1,
): string | null {
  const index = open.findIndex((project) => project.id === activeId)
  if (index < 0 || open.length < 2) return null
  return open[(index + direction + open.length) % open.length]!.id
}

/**
 * ⌘1..9 가 가리키는 프로젝트 id. 갈 곳이 없으면 null.
 *
 * **9 는 개수와 무관하게 마지막이다** — 크롬의 ⌘9 관례를 그대로 따른다. 탭이 셋인데
 * ⌘9 를 누르면 아무 일도 안 일어나는 것보다, 끝으로 가는 편이 손에 익은 동작이다.
 * 1~8 은 자리가 없으면(탭보다 큰 번호) null 이다 — **없는 자리를 마지막으로 눙치지 않는다.**
 * 그러면 ⌘5 와 ⌘6 이 같은 곳에 가서 "몇 번째인지" 라는 뜻이 사라진다.
 *
 * 이미 그 프로젝트를 보고 있어도 그대로 돌려준다 — 부르는 쪽이 `activate` 를 다시
 * 부를 뿐이고, 그건 무해하다 (`ProjectRegistry.activate` 가 같은 id 면 아무 일도 안 한다).
 */
export function projectAtIndex(open: readonly ProjectRecord[], slot: number): string | null {
  if (open.length === 0) return null
  if (slot === 9) return open[open.length - 1]!.id
  return open[slot - 1]?.id ?? null
}

/** App 이 렌더마다 부른다 — tabNavigation 과 같은 모양이다 (상태가 없어 훅일 필요가 없다) */
export function projectNavigation(
  projects: ProjectsApi,
): { next: () => void; prev: () => void; at: (slot: number) => void } {
  const go = (direction: 1 | -1) => {
    const id = cycleProject(projects.open, projects.activeId, direction)
    if (id) projects.activate(id)
  }
  return {
    next: () => go(1),
    prev: () => go(-1),
    at: (slot) => {
      const id = projectAtIndex(projects.open, slot)
      if (id) projects.activate(id)
    },
  }
}
