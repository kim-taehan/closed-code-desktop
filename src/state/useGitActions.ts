import { useCallback, useEffect, useRef } from 'react'
import type { GitStateHandle } from './useGitState'
import type { ToastApi } from './useToasts'

// 화면 수준에서 행동을 감싼다 — 확인 대화와 알림.
//
// 되돌리기는 되돌릴 수 없어 한 번 확인받고, 즐겨찾기는 결과가 화면에 잘 안 보여
// 토스트로 알린다. App.tsx 가 300줄을 넘겨 이 조각들을 따로 뗐다.

export function useRevertWithConfirm(git: GitStateHandle, toasts: ToastApi): (path: string) => void {
  return useCallback(
    (path: string) => {
      // 파일명을 넣어 확인받는다 — 무엇을 되돌리는지 분명해야 한다
      if (!window.confirm(`${path} 의 변경을 되돌릴까요? 되돌릴 수 없습니다.`)) return
      void git.revert(path).then((result) => {
        if (result.ok) toasts.show(`${path} 을 되돌렸습니다`)
        else toasts.show(result.message ?? '되돌리지 못했습니다', 'error')
      })
    },
    [git, toasts],
  )
}

/** 즐겨찾기 토글에 알림을 붙인다 — 별 하나 바뀌는 건 눈에 잘 안 띈다. */
export function useFavoriteWithToast(
  favorite: (id: string, next: boolean) => void,
  toasts: ToastApi,
): (project: { id: string; name: string; favorite: boolean }) => void {
  return useCallback(
    (project) => {
      const next = !project.favorite
      favorite(project.id, next)
      toasts.show(
        next ? `${project.name} 을 즐겨찾기에 담았습니다` : `${project.name} 을 즐겨찾기에서 뺐습니다`,
      )
    },
    [favorite, toasts],
  )
}

/**
 * 턴이 끝나면 git 을 다시 읽는다 (설계 §6) — 에이전트가 파일을 고쳤을 수 있다.
 * 스트리밍이 참→거짓으로 떨어지는 순간이 턴 종료다.
 */
export function useTurnEndRefresh(isStreaming: boolean, refresh: () => void): void {
  const was = useRef(false)
  useEffect(() => {
    if (was.current && !isStreaming) refresh()
    was.current = isStreaming
  }, [isStreaming, refresh])
}

/** 커밋. 결과를 토스트로 알린다. */
export function useCommit(git: GitStateHandle, toasts: ToastApi): (message: string) => void {
  return useCallback(
    (message: string) => {
      void git.commit(message).then((result) => {
        if (result.ok) toasts.show('커밋했습니다')
        else toasts.show(result.message ?? '커밋하지 못했습니다', 'error')
      })
    },
    [git, toasts],
  )
}

/**
 * 푸시. 업스트림이 없으면 한 번 확인받고 만들며 올린다 (설계 §7).
 *
 * 밖으로 나가는 행동이라 자동으로 원격을 만들지 않는다 — 사용자가 정한다.
 */
export function usePush(git: GitStateHandle, toasts: ToastApi): () => void {
  return useCallback(() => {
    const noUpstream = git.state.upstream === null
    if (noUpstream && !window.confirm('origin 에 이 브랜치를 만들어 올릴까요?')) return

    void git.push(noUpstream).then((result) => {
      if (result.ok) toasts.show('올렸습니다')
      else toasts.show(result.message ?? '올리지 못했습니다', 'error')
    })
  }, [git, toasts])
}

/** 당겨오기. 충돌은 git 메시지를 그대로 보여준다 — 해결은 터미널에서. */
export function usePull(git: GitStateHandle, toasts: ToastApi): () => void {
  return useCallback(() => {
    void git.pull().then((result) => {
      if (result.ok) toasts.show('당겨왔습니다')
      else toasts.show(result.message ?? '당겨오지 못했습니다', 'error')
    })
  }, [git, toasts])
}

export interface GitPanelActions {
  onRevert: (path: string) => void
  onPull: () => void
  onCommit: (message: string) => void
  onPush: () => void
}

/** 패널이 필요로 하는 행동을 한 묶음으로. App 이 콜백을 낱개로 나르지 않게. */
export function useGitPanelActions(git: GitStateHandle, toasts: ToastApi): GitPanelActions {
  return {
    onRevert: useRevertWithConfirm(git, toasts),
    onPull: usePull(git, toasts),
    onCommit: useCommit(git, toasts),
    onPush: usePush(git, toasts),
  }
}
