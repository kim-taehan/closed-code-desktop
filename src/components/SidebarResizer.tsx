import type { SidebarWidth } from '../state/useSidebarWidth'

// 사이드바와 본문 사이의 끌기 손잡이.
//
// 폭 자체는 useSidebarWidth 가 쥔다 — 여기서는 손잡이만 그린다.
// 얇은 띠지만 hit 영역은 넓게 둔다(패딩) — 1px 선은 정확히 겨냥하기 어렵다.

export interface SidebarResizerProps {
  sidebar: SidebarWidth
}

export function SidebarResizer({ sidebar }: SidebarResizerProps) {
  // 사이드바 오른쪽 경계에 얹는다. grid 열을 먹지 않아 레이아웃을 흔들지 않는다.
  return (
    <div
      className={`sidebar-resizer${sidebar.dragging ? ' sidebar-resizer--on' : ''}`}
      style={{ left: `${sidebar.width}px` }}
      onMouseDown={sidebar.startDrag}
      role="separator"
      aria-orientation="vertical"
      aria-label="사이드바 폭 조절"
    />
  )
}
