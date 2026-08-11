import { useCallback, useMemo } from 'react'
import type { ToastApi } from './useToasts'

// 묶음 단위 git 행동 — 모두 담기 / 모두 취소.
//
// `useGitActions.ts` 가 아니라 여기 있는 이유가 둘이다.
//  1) `useGitPanelActions` 가 내는 키 묶음은 테스트가 정확히 네 개로 잠가 두었다.
//     거기에 얹으면 파일 단위 행동과 묶음 행동이 한 봉투에 섞인다.
//  2) 묶음 행동은 `GitStateHandle` 을 거치지 않는다 — main 이 행동 뒤 새 상태를
//     밀어 주므로(`git:statePush`) 여기서 상태를 들고 있을 이유가 없다.
//
// **확인 대화를 붙이지 않는다.** 둘 다 인덱스만 옮길 뿐 작업트리의 내용을
// 지우지 않는다 — 되돌리려면 반대쪽 버튼을 누르면 된다.
//
// **성공 토스트도 띄우지 않는다.** 목록이 통째로 자리를 옮기는 것이 곧 결과다
// (체크 한 개 토글에 토스트가 없는 것과 같은 이유). 실패만 알린다.

export interface GitBulkActions {
  onStageAll: () => void
  onUnstageAll: () => void
}

export function useGitBulkActions(projectId: string | null, toasts: ToastApi): GitBulkActions {
  const onStageAll = useCallback(() => {
    if (projectId === null) return
    void window.davis.gitStageAll({ projectId }).then((result) => {
      if (!result.ok) toasts.show(result.message ?? '담지 못했습니다', 'error')
    })
  }, [projectId, toasts])

  // ⚠ 첫 커밋 전 저장소에서는 `fatal: could not resolve HEAD` 로 실패한다 (실측).
  // git 문구를 그대로 내보낸다 — 우리가 다시 쓴 문구는 검색이 안 된다.
  const onUnstageAll = useCallback(() => {
    if (projectId === null) return
    void window.davis.gitUnstageAll({ projectId }).then((result) => {
      if (!result.ok) toasts.show(result.message ?? '취소하지 못했습니다', 'error')
    })
  }, [projectId, toasts])

  return useMemo(() => ({ onStageAll, onUnstageAll }), [onStageAll, onUnstageAll])
}
