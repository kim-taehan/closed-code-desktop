import type { ProjectRecord } from '../../shared/projects/projectRecord'
import type { ProjectsApi } from './useProjects'

// 프로젝트 탭 전환 — ⌘/Ctrl + ←·→ 이 쓴다.
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

/** App 이 렌더마다 부른다 — tabNavigation 과 같은 모양이다 (상태가 없어 훅일 필요가 없다) */
export function projectNavigation(projects: ProjectsApi): { next: () => void; prev: () => void } {
  const go = (direction: 1 | -1) => {
    const id = cycleProject(projects.open, projects.activeId, direction)
    if (id) projects.activate(id)
  }
  return { next: () => go(1), prev: () => go(-1) }
}
