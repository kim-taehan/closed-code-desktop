// 프로젝트 하나의 기록. main 과 renderer 가 같은 타입을 본다.
//
// 동일성 판정은 언제나 `root` 로 한다 (설계 §4.3).
// `name` 은 표시용이라 바뀌어도 같은 프로젝트고, `id` 는 경로가 바뀌어도 유지된다.

export interface ProjectRecord {
  /** 안정적 식별자. 세션·이벤트가 이 값으로 프로젝트를 가리킨다. */
  id: string
  /** realpath 정규화된 절대경로. 동일성 판정의 유일한 기준. */
  root: string
  /** 표시용 이름. 기본값은 basename 이고 사용자가 바꿀 수 있다. */
  name: string
  /** 즐겨찾기. 정렬을 올리고 최근 목록 상한에서 빠진다 (설계 §4.5). */
  favorite: boolean
  /** 프로젝트별 라이선스. 없으면 상위로 위임한다 (설계 §4.1). */
  /** epoch ms */
  lastOpenedAt: number
  /**
   * 이 프로젝트에서 켠 확장의 이름(매니페스트 `name`). 설치는 앱 전체, 켜기는 프로젝트마다다
   * (확장 재설계 §3). 새 프로젝트는 `[]` 로 시작한다.
   *
   * **없음(undefined)과 빈 배열은 다른 뜻이다.** 없으면 이 기능 전에 만든 기록이라 아직
   * 이전하지 않은 것이고, 처음 필요할 때 옛 앱 전체 기준(설치 − `disabledExtensions`)으로
   * 채워 저장한다 (`electron/extensions/projectExtensions.ts`).
   */
  extensions?: string[]
}

/** 최근 목록 상한. 즐겨찾기는 여기 세지 않는다. */
export const RECENT_CAP = 15

/** 동시에 열 수 있는 프로젝트 수 (설계 §4.4). 4 → 10 (2026-08-24 사용자 요청) */
export const MAX_OPEN_PROJECTS = 10

/**
 * 즐겨찾기 먼저, 그 안에서 최근 연 순.
 *
 * 정렬을 한곳에 두는 이유는 목록·최근·화면이 같은 순서를 보여야 하기 때문이다.
 * 각자 정렬하면 어디선가 어긋난다.
 */
export function sortProjects(projects: readonly ProjectRecord[]): ProjectRecord[] {
  return [...projects].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
    return b.lastOpenedAt - a.lastOpenedAt
  })
}

/**
 * 최근 목록 상한을 적용한다.
 *
 * **즐겨찾기는 세지도 지우지도 않는다.** 세면 한동안 안 연 즐겨찾기가 조용히 사라져
 * 즐겨찾기를 한 의미가 없어진다 (설계 §4.5).
 */
export function pruneToRecentCap(
  projects: readonly ProjectRecord[],
  cap: number = RECENT_CAP,
): ProjectRecord[] {
  const sorted = sortProjects(projects)
  let kept = 0
  return sorted.filter((project) => {
    if (project.favorite) return true
    kept += 1
    return kept <= cap
  })
}
