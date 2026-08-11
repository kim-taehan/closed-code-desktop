import { useCallback, useMemo } from 'react'
import type { ToastApi } from './useToasts'

// 커밋바 `커밋 ▾` 메뉴의 행동 넷.
//
// `useGitActions` 에 얹지 않은 이유는 `useGitBulkActions` 와 같다 —
// `useGitPanelActions` 가 내는 키 묶음을 테스트가 정확히 넷으로 잠가 두었다.
//
// **채널이 있는 것만 넣는다.** 넷 다 이미 선 채널이다
// (`gitStageAll`·`gitCommit`·`gitAmend`·`gitUndoCommit`).
//
// 순서가 있는 것(모두 담고 커밋 / 커밋 후 푸시)은 여기서 이어 붙인다. `useGitActions`
// 의 `onCommit` 은 결과를 돌려주지 않아(void) 뒤를 이을 수 없다. 그래서 커밋 호출을
// 여기서 한 번 더 하고, **문구는 `useCommit` 과 같은 것을 쓴다** — 같은 행동이
// 자리마다 다르게 말하면 안 된다.

export interface ScmCommitMenu {
  /** 변경사항을 전부 담고 그대로 커밋한다 */
  onCommitAll: (message: string) => void
  /** 커밋한 뒤 이어서 올린다 (업스트림 확인은 넘겨받은 onPush 가 한다) */
  onCommitPush: (message: string) => void
  /** 직전 커밋에 합친다. **이미 올린 커밋이면 원격과 어긋나** 한 번 확인받는다. */
  onAmend: (message: string) => void
  /** 커밋만 무른다. 변경은 담긴 채로 남는다 (`--soft`). */
  onUndoCommit: () => void
}

export function useScmCommit(
  projectId: string | null,
  toasts: ToastApi,
  onPush: () => void,
): ScmCommitMenu {
  const onCommitAll = useCallback(
    (message: string) => {
      if (projectId === null) return
      void window.davis.gitStageAll({ projectId }).then((staged) => {
        // 담기가 실패하면 커밋으로 넘어가지 않는다 — 무엇이 들어갈지 모른 채 커밋하게 된다.
        if (!staged.ok) {
          toasts.show(staged.message ?? '담지 못했습니다', 'error')
          return
        }
        void window.davis.gitCommit({ projectId, message }).then((result) => {
          if (result.ok) toasts.show('커밋했습니다')
          else toasts.show(result.message ?? '커밋하지 못했습니다', 'error')
        })
      })
    },
    [projectId, toasts],
  )

  const onCommitPush = useCallback(
    (message: string) => {
      if (projectId === null) return
      void window.davis.gitCommit({ projectId, message }).then((result) => {
        if (!result.ok) {
          toasts.show(result.message ?? '커밋하지 못했습니다', 'error')
          return
        }
        toasts.show('커밋했습니다')
        // 올리기는 넘겨받은 것을 그대로 부른다 — 업스트림이 없을 때의 확인 대화가
        // 거기 있다 (`usePush`). 여기서 다시 만들면 두 곳에서 다른 것을 묻게 된다.
        onPush()
      })
    },
    [projectId, toasts, onPush],
  )

  const onAmend = useCallback(
    (message: string) => {
      if (projectId === null) return
      // ⚠ 인덱스에 담긴 것이 함께 들어간다 (`desktopBridge.gitAmend` 주석).
      if (!window.confirm('마지막 커밋에 합칠까요? 담아 둔 변경이 함께 들어갑니다.')) return
      void window.davis.gitAmend({ projectId, message }).then((result) => {
        if (result.ok) toasts.show('마지막 커밋에 합쳤습니다')
        else toasts.show(result.message ?? '합치지 못했습니다', 'error')
      })
    },
    [projectId, toasts],
  )

  const onUndoCommit = useCallback(() => {
    if (projectId === null) return
    if (!window.confirm('마지막 커밋을 취소할까요? 변경 내용은 담긴 채로 남습니다.')) return
    void window.davis.gitUndoCommit({ projectId }).then((result) => {
      if (result.ok) toasts.show('커밋을 취소했습니다')
      else toasts.show(result.message ?? '취소하지 못했습니다', 'error')
    })
  }, [projectId, toasts])

  return useMemo(
    () => ({ onCommitAll, onCommitPush, onAmend, onUndoCommit }),
    [onCommitAll, onCommitPush, onAmend, onUndoCommit],
  )
}
