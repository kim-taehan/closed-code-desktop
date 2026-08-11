import type { ExtensionRow, ExtensionRowsByView } from './extensionRows'
import { useProjectViewCache } from './useProjectViewCache'

// 확장이 넘긴 결과를 뷰별로 들고 있는 상태.
//
// **여기서 IPC 를 부르지 않는다.** main→renderer push 를 이 훅에 물리는 것은
// 배선 단계의 몫이고(`extension:rows` 채널), 이 훅은 밀려온 것을 받아 담기만 한다.
// 그래야 "겉봉 검사"·"프로젝트별로 나눠 쥐기" 규칙을 IPC 없이 테스트로 잠글 수 있다.
//
// 담는 규칙은 `useProjectViewCache` 가 쥔다 — 이 훅은 이름과 타입만 준다.

export interface ExtensionRowsHandle {
  rowsByView: ExtensionRowsByView
  /**
   * 밀려온 결과를 반영한다. 겉봉의 `projectId` 가 지금 보는 프로젝트와 다르면 버린다.
   *
   * 같은 뷰에 다시 오면 **덮어쓴다.** `setRows` 는 이어붙이기가 아니라 통째 교체다
   * (계획서 §2.4) — 명령을 다시 돌리면 이전 결과가 남아 있으면 안 된다.
   */
  apply: (projectId: string, viewId: string, rows: ExtensionRow[]) => void
}

export function useExtensionRows(projectId: string | null): ExtensionRowsHandle {
  const { byView, apply } = useProjectViewCache<ExtensionRow[]>(projectId)
  return { rowsByView: byView, apply }
}
