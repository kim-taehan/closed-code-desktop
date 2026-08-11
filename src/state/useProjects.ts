import { useCallback, useEffect, useState } from 'react'
import type { ProjectStatePayload } from '../../shared/ipc/channels'

// 프로젝트 목록 상태와 조작을 한곳에 모은다.
// App 은 이 훅만 쓰고 IPC 를 직접 부르지 않는다.

const EMPTY: ProjectStatePayload = { all: [], open: [], activeId: null }

export interface ProjectsApi extends ProjectStatePayload {
  /** 첫 목록이 도착했는가. 도착 전에는 화면을 정하지 않는다 (런처가 번쩍인다). */
  loaded: boolean
  /** 열기 실패 사유. 5개 상한 등. 성공하면 null 로 지운다. */
  error: string | null
  dismissError: () => void
  /** 성공하면 true. 취소·실패는 false — 호출부가 런처를 닫을지 판단한다. */
  pick: () => Promise<boolean>
  openRoot: (root: string) => Promise<boolean>
  activate: (id: string) => void
  close: (id: string) => void
  rename: (id: string, name: string) => void
  favorite: (id: string, favorite: boolean) => void
}

export function useProjects(): ProjectsApi {
  const [state, setState] = useState<ProjectStatePayload>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const off = window.davis.onProjectState(setState)
    // 구독을 붙이기 전에 밀려온 상태를 놓칠 수 있으므로 직접 한 번 가져온다.
    // 이게 없으면 프로젝트가 열려 있는데도 런처가 뜬다.
    void window.davis.listProjects().then((initial) => {
      setState(initial)
      setLoaded(true)
    })
    return off
  }, [])

  // 취소는 실패가 아니라 message 가 없다 — 그때는 아무 것도 알리지 않는다
  const report = useCallback((result: { ok: boolean; message?: string }) => {
    setError(result.ok ? null : (result.message ?? null))
    return result.ok
  }, [])

  const pick = useCallback(() => window.davis.pickProject().then(report), [report])

  const openRoot = useCallback(
    (root: string) => window.davis.openProject({ root }).then(report),
    [report],
  )

  return {
    ...state,
    loaded,
    error,
    dismissError: useCallback(() => setError(null), []),
    pick,
    openRoot,
    activate: useCallback((id: string) => {
      void window.davis.activateProject({ id })
    }, []),
    close: useCallback((id: string) => {
      void window.davis.closeProject({ id })
    }, []),
    rename: useCallback((id: string, name: string) => {
      void window.davis.renameProject({ id, name })
    }, []),
    favorite: useCallback((id: string, favorite: boolean) => {
      void window.davis.favoriteProject({ id, favorite })
    }, []),
  }
}
