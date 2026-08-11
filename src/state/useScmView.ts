import { useEffect, useState } from 'react'
import type { ActiveTab } from './useOpenFiles'

// 소스 관리 탭 **안**의 선택 — 갈래·파일·커밋.
//
// 탭 자체의 여닫이는 App 이 boolean 으로 쥔다 (로그 탭과 같은 규칙). 여기는 그 안쪽이다.
// 프로젝트가 바뀌면 통째로 비운다 (`useGitState` 와 같은 규칙) — 남겨 두면 앞 저장소에서
// 고른 파일·커밋이 새 저장소 화면에 그대로 남는다.

/** 본문 탭 식별자. 'logs' 처럼 파일 경로가 아닌 예약 문자열이다 (파일 경로는 항상 절대경로). */
export const SCM_TAB = 'git'

/** 탭 안의 갈래 3개 */
export type ScmView = 'changes' | 'history' | 'branches'

export interface ScmViewHandle {
  view: ScmView
  selectView: (view: ScmView) => void
  /** 왼쪽 목록에서 고른 파일 경로. 아직 아무것도 안 골랐으면 null */
  file: string | null
  selectFile: (path: string | null) => void
  /** 히스토리에서 고른 커밋 해시 */
  commit: string | null
  selectCommit: (hash: string | null) => void
}

export function useScmView(projectId: string | null): ScmViewHandle {
  const [view, setView] = useState<ScmView>('changes')
  const [file, setFile] = useState<string | null>(null)
  const [commit, setCommit] = useState<string | null>(null)

  useEffect(() => {
    setView('changes')
    setFile(null)
    setCommit(null)
  }, [projectId])

  return { view, selectView: setView, file, selectFile: setFile, commit, selectCommit: setCommit }
}

/**
 * 이 탭에서 ChatComposer 를 감추는가 (리더 결정 #1).
 *
 * 소스 관리 탭은 **자체 커밋바**를 가진다 — composer 를 그대로 두면 입력칸이 세로로 2겹이 되고,
 * `viewingFile` 칩이 'git' 을 파일명처럼 표시한다. 파일·로그 탭은 지금 동작 그대로 둔다.
 */
export function hidesComposer(active: ActiveTab): boolean {
  return active === SCM_TAB
}
