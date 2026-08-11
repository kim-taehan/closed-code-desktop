import { useCallback, useEffect, useState } from 'react'
import { EMPTY_GIT_STATE, type GitState } from '../../shared/git/gitState'
import type { GitActionResult } from '../../shared/ipc/gitPayloads'

// 소스 관리 상태 구독.
//
// 프로젝트가 바뀌면 **통째로 비운다** (`useFileTree` 와 같은 규칙).
// 남겨 두면 새 프로젝트의 답이 오기 전까지 남의 저장소 상태가 잠깐 보인다.

export interface GitStateHandle {
  state: GitState
  loading: boolean
  refresh: () => void
  /** 담기(true)/빼기(false). 결과는 밀려오는 새 상태로 반영된다. */
  toggle: (path: string, stage: boolean) => Promise<void>
  /** 되돌리기. 되돌릴 수 없는 행동이라 확인은 부르는 쪽 책임이다. */
  revert: (path: string) => Promise<GitActionResult>
  commit: (message: string) => Promise<GitActionResult>
  /** 올린다. 업스트림 만들기는 부르는 쪽이 확인받은 뒤 setUpstream 으로 넘긴다. */
  push: (setUpstream: boolean) => Promise<GitActionResult>
  pull: () => Promise<GitActionResult>
  /** ⟳ — 원격을 확인하고 다시 읽는다 (fetch 동반) */
  refetch: () => void
}

export function useGitState(projectId: string | null, active: boolean): GitStateHandle {
  const [state, setState] = useState<GitState>(EMPTY_GIT_STATE)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)

  // 프로젝트(또는 활성 여부)가 바뀌면 이전 저장소 상태를 **즉시** 비운다 —
  // 새 프로젝트의 답이 오기 전까지 남의(이전 탭) git 상태가 잠깐 보이는 것을 막는다.
  // nonce(수동 새로고침)는 일부러 뺀다 — 같은 프로젝트를 새로고침할 때 깜빡 비우면 안 된다.
  useEffect(() => {
    setState(EMPTY_GIT_STATE)
  }, [projectId, active])

  useEffect(() => {
    if (projectId === null || !active) {
      setState(EMPTY_GIT_STATE)
      return
    }

    // 답이 늦게 온 사이에 프로젝트를 옮겼으면 그 답을 버린다
    let alive = true
    setLoading(true)
    void window.davis.gitState({ projectId }).then((result) => {
      if (!alive) return
      setState(result.state)
      setLoading(false)
    })

    return () => {
      alive = false
    }
  }, [projectId, active, nonce])

  // main 이 알려 오는 변화. 겉봉의 projectId 가 지금 보는 것과 다르면 버린다 —
  // 다른 탭의 저장소가 바뀐 것을 이 화면에 그리면 안 된다.
  useEffect(() => {
    if (projectId === null) return
    return window.davis.onGitState((payload, id) => {
      if (id === projectId) setState(payload.state)
    })
  }, [projectId])

  const toggle = useCallback(
    async (path: string, stage: boolean) => {
      if (projectId === null) return
      // 실패해도 main 이 새 상태를 밀어 화면을 사실과 맞춰 둔다. 여기서 되돌리지 않는다.
      await (stage
        ? window.davis.gitStage({ projectId, path })
        : window.davis.gitUnstage({ projectId, path }))
    },
    [projectId],
  )

  const revert = useCallback(
    async (path: string): Promise<GitActionResult> => {
      if (projectId === null) return { ok: false, message: '프로젝트가 없습니다' }
      return window.davis.gitRevert({ projectId, path })
    },
    [projectId],
  )

  const commit = useCallback(
    (message: string): Promise<GitActionResult> =>
      projectId === null
        ? Promise.resolve({ ok: false, message: '프로젝트가 없습니다' })
        : window.davis.gitCommit({ projectId, message }),
    [projectId],
  )

  const push = useCallback(
    (setUpstream: boolean): Promise<GitActionResult> =>
      projectId === null
        ? Promise.resolve({ ok: false, message: '프로젝트가 없습니다' })
        : window.davis.gitPush({ projectId, setUpstream }),
    [projectId],
  )

  const pull = useCallback(
    (): Promise<GitActionResult> =>
      projectId === null
        ? Promise.resolve({ ok: false, message: '프로젝트가 없습니다' })
        : window.davis.gitPull({ projectId }),
    [projectId],
  )

  const refetch = useCallback(() => {
    if (projectId !== null) void window.davis.gitRefresh({ projectId })
  }, [projectId])

  return {
    state,
    loading,
    refresh: () => setNonce((value) => value + 1),
    toggle,
    revert,
    commit,
    push,
    pull,
    refetch,
  }
}
