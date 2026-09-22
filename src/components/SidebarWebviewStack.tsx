import { useState } from 'react'
import { ExtensionWebview } from './ExtensionWebview'
import type { ExtensionPanelTarget } from '../state/extensionPanels'
import type { SidebarPanel } from './SidebarPanelSelect'
import '../styles/extensions.css'

// 사이드바 웹뷰 (매니페스트 3판 `location: 'sidebar'`, 하이닉스 H2 결정 K-1).
//
// 규칙은 본문 웹뷰 탭(`ExtensionWebviewStack.tsx`)과 같다 — **한 번 띄운 것은 내리지 않고 CSS 로 감춘다.**
// 프로젝트·소스 관리로 갔다 돌아올 때마다 iframe 이 내려지면 앞단이 다시 뜨고 스크롤·입력·고른 것이 날아간다.
// 그래서 이 묶음은 사이드바 본문(`ProjectSidebar`) 안에서 **늘 같은 자리**에 있다 (DOM 에서 자리를 옮기면
// iframe 이 다시 실린다).
//
// 띄우는 때는 **처음 고를 때**다 — 선택기에 이름이 있다고 미리 띄우지 않는다 (안 보는 확장의 앞단을 돌리지 않는다).
// 토큰·CSP·sandbox·메시지 행선지는 `ExtensionWebview` 그대로다: 토큰은 (확장·뷰·프로젝트)를 묶고, 그 프로젝트에서
// 켜지지 않았으면 main 이 띄우지 않는다 (`serviceLoad.webview`).
//
// **프로젝트를 옮기면 다시 띄운다.** 사이드바 모델이 「무엇을 볼지는 프로젝트마다」(`useSidebarPanel`)이고,
// 앞 프로젝트의 iframe 은 그 프로젝트의 토큰이라 새 프로젝트에서 쓸 수 없다. 본문 탭도 프로젝트를 옮기면
// 닫혔다 새로 뜬다 (재설계 기록 O-3) — 같은 결이다.

export interface SidebarWebviewStackProps {
  projectId: string
  /** 지금 고른 패널. 이것과 id 가 같은 것만 보인다 */
  panel: SidebarPanel
  /** 이 프로젝트에서 켜진 확장의 패널들 (`extensionPanelTargets`). 여기서 빠지면(꺼짐·삭제) 내린다 */
  panels: ExtensionPanelTarget[]
}

export function SidebarWebviewStack({ projectId, panel, panels }: SidebarWebviewStackProps) {
  // 한 번이라도 고른 사이드바 웹뷰 패널. **프로젝트가 바뀌면 비운다** (머리말)
  const [shown, setShown] = useState<{ projectId: string; ids: string[] }>({ projectId, ids: [] })
  const ids = shown.projectId === projectId ? shown.ids : []
  const picked = panels.some((target) => target.id === panel && target.sidebarWebview !== undefined)
  // 렌더 중에 고친다 (앞 렌더에서 온 값으로 상태를 맞추는 React 의 정해진 모양) — 효과로 미루면
  // 고른 직후 한 번은 빈 칸이 그려진다. 조건이 곧 거짓이 되므로 되풀이되지 않는다
  if (shown.projectId !== projectId || (picked && !ids.includes(panel))) {
    setShown({ projectId, ids: picked && !ids.includes(panel) ? [...ids, panel] : ids })
  }

  return (
    <>
      {panels.map((target) =>
        target.sidebarWebview === undefined || !ids.includes(target.id) ? null : (
          <div
            // 프로젝트까지 키에 넣는다 — 같은 확장이라도 프로젝트가 다르면 다른 토큰·다른 문서다
            key={`${projectId}:${target.id}`}
            className={`ext-webview ext-webview--sidebar${target.id === panel ? '' : ' ext-webview--hidden'}`}
            data-panel={target.id}
          >
            <ExtensionWebview
              target={{ extension: target.extension.name, viewId: target.sidebarWebview.id, projectId }}
            />
          </div>
        ),
      )}
    </>
  )
}
