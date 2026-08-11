import { useProjectViewCache } from './useProjectViewCache'

// 확장이 넘긴 **화면(HTML)** 을 뷰별로 들고 있는 상태.
//
// `useExtensionRows` 와 규칙이 같다 — 겉봉이 다르면 버리고, 프로젝트별로 나눠 쥐고,
// 같은 뷰에 다시 오면 덮어쓴다. 값의 타입만 다르다(행 배열 vs 문자열).
// 셋째(`useExtensionTree`)가 생겨 담는 규칙은 `useProjectViewCache` 로 뽑았다.

export type ExtensionHtmlByView = Record<string, string>

export interface ExtensionHtmlHandle {
  htmlByView: ExtensionHtmlByView
  /** 밀려온 화면을 반영한다. 겉봉이 지금 보는 프로젝트와 다르면 버린다. */
  apply: (projectId: string, viewId: string, html: string) => void
}

export function useExtensionHtml(projectId: string | null): ExtensionHtmlHandle {
  const { byView, apply } = useProjectViewCache<string>(projectId)
  return { htmlByView: byView, apply }
}
