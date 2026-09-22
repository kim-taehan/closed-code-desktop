import { useEffect } from 'react'
import type { ExtensionUiTarget } from '../../shared/ipc/extensionUiBridge'

// 웹뷰 탭(매니페스트 3판)을 여는 **두 문을 한 길로** 모은다 (E5).
//
//  1. 확장 명령이 부른 `code.ui.open` — main 이 밀어 준다 (`EXTENSION_UI_OPEN`)
//  2. 설정 창 확장 목록의 「열기」 — `requestExtensionView` 를 부른다
//
// 명령 팔레트가 없어 셋째 문(`contributes.commands` → 팔레트, 설계 §2-2)은 아직 없다.
//
// 설정 창은 앱 트리 깊숙이 있어 탭 목록(`useOpenFiles`)까지 속성으로 내려 받으려면 네 겹을 뚫어야
// 한다. `/open` 이 같은 문제를 모듈 수준 처리기로 푼 선례(`setOpenFileHandler`)를 따른다.

type Opener = (target: ExtensionUiTarget, label: string) => void

let opener: Opener | null = null

/** 설정 창 「열기」가 부른다. 앱이 아직 처리기를 안 걸었으면 아무 일도 없다 */
export function requestExtensionView(target: ExtensionUiTarget, label: string): void {
  opener?.(target, label)
}

/**
 * **지금 보고 있는 프로젝트의 것만** 연다. 본문 탭은 프로젝트마다 비워지므로(`useOpenFiles`)
 * 다른 프로젝트 탭을 여기서 만들 자리가 없다 — 만들면 P 의 화면이 Q 에 뜬다.
 */
export function useExtensionViewOpen(activeProjectId: string | null, openWebview: Opener): void {
  useEffect(() => {
    const open: Opener = (target, label) => {
      if (target.projectId === activeProjectId) openWebview(target, label)
    }
    opener = open
    const off = window.davis.onExtensionUiOpen((payload, projectId) =>
      open({ extension: payload.extension, viewId: payload.viewId, projectId }, payload.title),
    )
    return () => {
      off()
      if (opener === open) opener = null
    }
  }, [activeProjectId, openWebview])
}
