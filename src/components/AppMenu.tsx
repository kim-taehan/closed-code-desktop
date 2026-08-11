import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n/messages'
import { setOpenLogsHandler } from '../state/slashCommands'
// 단축키 표기는 설정의 목록(ShortcutsSection)과 같은 판정을 쓴다 — 복사하면 두 곳이 갈린다.
import { accel } from '../state/modKey'

// 오른쪽 위 ⋮ 메뉴. 여는 것만 맡고 내용은 각 창이 가진다.

export interface AppMenuProps {
  onSettings: () => void
  onLogs: () => void
  /** 개발자 모드에서만 "로그 보기"를 노출한다 (이미 열린 로그 탭은 건드리지 않는다) */
  developerMode?: boolean
}

export function AppMenu({ onSettings, onLogs, developerMode }: AppMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismissOnOutside(ref, () => setOpen(false), open)
  // `/logs` 도 같은 동작을 부른다. 로그 탭을 여는 손잡이를 쥔 곳이 여기라 여기서 심는다
  // (ChatComposer 가 setSendToRuntime 을 심는 것과 같은 구조).
  useEffect(() => {
    setOpenLogsHandler(onLogs)
    return () => setOpenLogsHandler(null)
  }, [onLogs])

  return (
    <div className="app-menu" ref={ref}>
      <button
        type="button"
        className="app-menu__toggle"
        onClick={() => setOpen((value) => !value)}
        title={t('설정·메뉴')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⚙
      </button>

      {open && (
        <div className="app-menu__panel" role="menu">
          <MenuItem
            icon="⚙"
            label={t('설정…')}
            keys={accel(',')}
            onSelect={() => {
              onSettings()
              setOpen(false)
            }}
          />
          {developerMode && (
            <>
              <div className="app-menu__divider" />
              {/* ⌘L 도 개발자 모드에서만 등록된다 (App.tsx → useShortcuts) — 보이는 것과 먹는 것이 같다 */}
              <MenuItem
                icon="◷"
                label={t('로그 보기')}
                keys={accel('L')}
                onSelect={() => {
                  onLogs()
                  setOpen(false)
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface MenuItemProps {
  icon: string
  label: string
  /** 없으면 그 자리를 비운다 — 등록되지 않은 키를 지어내지 않는다 */
  keys?: string
  onSelect: () => void
}

/** 항목 한 줄 — `아이콘 | 라벨 | 단축키` 3열 (시안 안 A). */
function MenuItem({ icon, label, keys, onSelect }: MenuItemProps) {
  return (
    <button type="button" role="menuitem" className="app-menu__item" onClick={onSelect}>
      <span className="app-menu__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="app-menu__label">{label}</span>
      {keys !== undefined && <span className="app-menu__keys">{keys}</span>}
    </button>
  )
}

/** 바깥을 누르면 닫는다. 열려 있을 때만 듣는다. */
function useDismissOnOutside(
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
