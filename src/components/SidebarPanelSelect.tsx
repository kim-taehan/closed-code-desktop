import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n/messages'
import { isExtensionPanelId, type ExtensionPanelId } from '../state/extensionPanels'

// 사이드바가 무엇을 보여줄지 고르는 선택기 (IntelliJ 의 "Project ⌄" 자리).
//
// 탭이 아니라 드롭다운인 이유는 앞으로 항목이 늘기 때문이다 —
// git·변경된 파일이 붙으면 탭은 좁은 사이드바에서 글자가 먼저 잘린다.
//
// 꺾쇠는 **채워진 삼각형**이다. 트리가 쓰는 얇은 꺾쇠와 같은 모양을 쓰면
// 트리의 첫 줄처럼 보인다.

// 확장은 여기 고정 칸으로 두지 않는다 — 확장이 **자기 패널을 등록한다.**
// 「확장」이라는 칸 하나에 전부 몰아넣으면 어느 확장의 결과인지 알 수 없어진다.
// 설치·삭제 같은 관리는 여전히 설정 창에서 한다.
type BuiltinPanel = 'files' | 'git' | 'history' | 'run'

export type SidebarPanel = BuiltinPanel | ExtensionPanelId

export const PANEL_LABEL: Record<BuiltinPanel, string> = {
  files: '프로젝트',
  git: '소스 관리',
  history: '채팅이력',
  run: '실행',
}

/**
 * 표시 순서. 기본값은 맨 앞이다. 확장 패널은 이 뒤에 붙는다.
 *
 * 「실행」은 **내장**이다 (설계 2026-08-16 §0) — 확장으로 하면 확장 API 에 프로세스 실행을
 * 더해야 하고, 실행은 모든 프로젝트가 늘 쓰는 것이라 「선택 설치」의 값이 안 나온다.
 */
const PANELS: BuiltinPanel[] = ['files', 'git', 'history', 'run']

/** 확장이 등록한 패널 하나. `title` 은 매니페스트의 뷰 제목이라 번역하지 않는다. */
export interface ExtensionPanelOption {
  id: ExtensionPanelId
  title: string
}

export interface SidebarPanelSelectProps {
  panel: SidebarPanel
  onChange: (panel: SidebarPanel) => void
  /** 확장이 등록한 패널들. 없으면 내장 3개만 나온다 */
  extensionPanels?: ExtensionPanelOption[]
  /**
   * 목록을 펼칠 때. 설정 창에서 확장을 방금 설치했을 수 있으므로 **여는 순간 다시 받는다** —
   * 이것이 없으면 새로 깐 확장이 앱을 껐다 켜기 전까지 이 목록에 안 뜬다.
   */
  onOpen?: () => void
}

export function SidebarPanelSelect({ panel, onChange, extensionPanels = [], onOpen }: SidebarPanelSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismissOnOutside(ref, () => setOpen(false), open)

  const label = isExtensionPanelId(panel)
    ? // 고른 확장이 지워졌다면 여기 이름이 없다. 그 상태를 화면에 그릴 일은 없다 —
      // `ProjectSidebar` 가 목록에서 사라진 패널을 프로젝트로 되돌린다.
      (extensionPanels.find((option) => option.id === panel)?.title ?? '')
    : t(PANEL_LABEL[panel])

  return (
    <div className="dc-panel-select" ref={ref}>
      <button
        type="button"
        className="dc-panel-select__toggle"
        onClick={() => {
          setOpen((value) => {
            if (!value) onOpen?.()
            return !value
          })
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`dc-panel-select__caret${open ? ' dc-panel-select__caret--open' : ''}`} />
        {label}
      </button>

      {open && (
        <div className="dc-panel-select__menu" role="listbox">
          {PANELS.map((candidate) => (
            <Item
              key={candidate}
              label={t(PANEL_LABEL[candidate])}
              active={candidate === panel}
              onPick={() => {
                onChange(candidate)
                setOpen(false)
              }}
            />
          ))}

          {/* 내장과 확장 사이에 선을 하나 둔다 — 확장이 늘면 어디까지가 앱 것인지 구분이 필요하다 */}
          {extensionPanels.length > 0 && <div className="dc-panel-select__rule" />}

          {extensionPanels.map((option) => (
            <Item
              key={option.id}
              label={option.title}
              active={option.id === panel}
              onPick={() => {
                onChange(option.id)
                setOpen(false)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Item({ label, active, onPick }: { label: string; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`dc-panel-select__item${active ? ' dc-panel-select__item--active' : ''}`}
      onClick={onPick}
    >
      {label}
    </button>
  )
}

/**
 * 바깥을 누르면 닫는다. 열려 있을 때만 듣는다.
 *
 * `GitBranchChip` 의 전환 메뉴도 이것을 쓴다 — 레포에 같은 훅이 이미 여러 벌이라
 * 새 벌을 만들지 않았다.
 */
export function useDismissOnOutside(
  ref: React.RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return

    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, onDismiss, active])
}
