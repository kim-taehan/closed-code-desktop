import { useEffect, useRef } from 'react'
import { useDismissOnOutside } from './SidebarPanelSelect'
import type { TabCloseTargets } from '../state/tabCloseTargets'

// 탭 우클릭 메뉴 — 닫기 갈래 넷 (IntelliJ 의 탭 컨텍스트 메뉴).
//
// **탭 줄 안에 그리지 않는다.** 탭 줄은 `overflow-x: auto` 라 그 안에 두면 메뉴가 잘린다.
// 그래서 위치를 좌표로 받아 `position: fixed` 로 띄우고, 부르는 쪽(`MainBar`)이 줄 바깥에 건다.
//
// 바깥 클릭으로 닫는 규칙은 `SidebarPanelSelect` 의 훅을 그대로 쓴다 — 레포에 이미 있는 것이다.

export interface MainTabMenuProps {
  /** 화면 좌표 (contextmenu 이벤트의 clientX/Y) */
  x: number
  y: number
  targets: TabCloseTargets
  onClose: (paths: string[]) => void
  onDismiss: () => void
}

export function MainTabMenu({ x, y, targets, onClose, onDismiss }: MainTabMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  useDismissOnOutside(ref, onDismiss, true)

  // Esc 로도 닫는다 — 열어 놓고 아무것도 안 고르는 것이 흔한 경로다
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onDismiss])

  const items: { label: string; paths: string[] }[] = [
    { label: '닫기', paths: targets.self },
    { label: '나머지 모두 닫기', paths: targets.others },
    { label: '왼쪽 모두 닫기', paths: targets.left },
    { label: '오른쪽 모두 닫기', paths: targets.right },
  ]

  return (
    <div className="tab-menu" role="menu" ref={ref} style={{ left: x, top: y }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="tab-menu__item"
          // 닫을 것이 없으면 잠근다. **감추지 않는다** — 항목이 자리를 옮겨 다니면
          // 매번 어디를 눌러야 하는지 다시 읽어야 한다.
          disabled={item.paths.length === 0}
          onClick={() => {
            onClose(item.paths)
            onDismiss()
          }}
        >
          {item.label}
          {/* 몇 개가 닫히는지 미리 보여준다 — 되돌릴 수 없는 조작이다 */}
          {item.paths.length > 1 && <span className="tab-menu__count">{item.paths.length}</span>}
        </button>
      ))}
    </div>
  )
}
