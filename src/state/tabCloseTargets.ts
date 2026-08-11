import type { OpenFile } from './useOpenFiles'

// 탭 우클릭 메뉴가 닫을 대상들. 순수 계산이라 화면과 갈라 둔다.
//
// **화면에 보이는 순서가 곧 왼쪽·오른쪽이다.** `files` 배열 순서가 그 순서이고
// (`MainTabs` 가 그대로 그린다), 정렬을 끼우면 메뉴가 엉뚱한 것을 닫는다.

export interface TabCloseTargets {
  /** 이 탭만 */
  self: string[]
  /** 이 탭 빼고 전부 */
  others: string[]
  /** 이 탭보다 왼쪽 */
  left: string[]
  /** 이 탭보다 오른쪽 */
  right: string[]
}

/**
 * 우클릭한 탭 기준으로 닫을 목록 넷을 만든다.
 *
 * 목록에 없는 경로면 전부 빈 배열이다 — 메뉴가 열려 있는 사이에 그 탭이 닫혔을 수 있고,
 * 그때 "나머지 모두" 가 **전부 닫기**로 돌변하면 안 된다.
 */
export function tabCloseTargets(files: OpenFile[], target: string): TabCloseTargets {
  const at = files.findIndex((file) => file.path === target)
  if (at === -1) return { self: [], others: [], left: [], right: [] }

  const paths = files.map((file) => file.path)
  return {
    self: [target],
    others: paths.filter((path) => path !== target),
    left: paths.slice(0, at),
    right: paths.slice(at + 1),
  }
}
