import { useCallback, useEffect, useRef, useState } from 'react'
import type { DirEntryPayload } from '../../shared/ipc/channels'

// 파일 트리 상태. 펼친 디렉토리만 읽어 둔다 (지연 확장).
//
// 프로젝트를 바꾸면 통째로 버린다 — 남겨 두면 남의 트리가 잠깐 보인다.

/** 상대경로 → 그 디렉토리의 항목들. 루트는 빈 문자열 키를 쓴다. */
export type TreeChildren = Record<string, DirEntryPayload[]>

export interface FileTreeApi {
  children: TreeChildren
  expanded: Set<string>
  loading: Set<string>
  toggle: (path: string) => void
}

export function useFileTree(projectId: string | null): FileTreeApi {
  const [children, setChildren] = useState<TreeChildren>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  // 지금 열려 있는 프로젝트를 항상 최신으로 든다. load 클로저에 캡처된 projectId 로
  // 비교하면, A 로 시작한 옛 호출이 자기 자신(=A)과 비교해 통과해 버린다(stale 누수).
  const activeProject = useRef(projectId)
  activeProject.current = projectId

  const load = useCallback(
    async (id: string, path: string) => {
      setLoading((current) => new Set(current).add(path))
      const result = await window.davis.readDir({ projectId: id, path })
      // 읽는 동안 프로젝트가 바뀌었으면 버린다 — 남의 트리를 섞지 않는다
      if (id !== activeProject.current) return
      setChildren((current) => ({ ...current, [path]: result.entries }))
      setLoading((current) => {
        const next = new Set(current)
        next.delete(path)
        return next
      })
    },
    [projectId],
  )

  // 프로젝트가 바뀌면 트리를 새로 시작한다
  useEffect(() => {
    setChildren({})
    setExpanded(new Set())
    setLoading(new Set())
    if (projectId !== null) void load(projectId, '')
  }, [projectId, load])

  const toggle = useCallback(
    (path: string) => {
      setExpanded((current) => {
        const next = new Set(current)
        if (next.has(path)) {
          next.delete(path)
          return next
        }
        next.add(path)
        // 한 번 읽은 디렉토리는 다시 읽지 않는다 — 접었다 펴는 것이 흔하다
        if (projectId !== null && children[path] === undefined) void load(projectId, path)
        return next
      })
    },
    [projectId, children, load],
  )

  return { children, expanded, loading, toggle }
}
