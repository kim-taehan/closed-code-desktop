import { useEffect, useRef, useState } from 'react'
import {
  ALL_PERMISSION_MODES,
  PERMISSION_MODE_HINT,
  PERMISSION_MODE_ICON,
  PERMISSION_MODE_LABEL,
  PermissionMode,
} from '../../shared/protocol/kinds'

// 권한 모드 선택기 (ADR-011 §4). 배치·문구는 desktop2 의 ModesButton 을 따른다.
//
// 문구를 줄이지 않는다 — acceptEdits 의 "파일 편집 도구를" 은 정확한 진술이다.
// run_command 는 자동 승인 대상이 아니어서, "전부 자동 승인" 으로 줄이면
// 셸도 자동으로 도는 줄 알고 켜게 된다.

export interface PermissionModeSwitchProps {
  mode: PermissionMode
  onChange: (mode: PermissionMode) => void
  disabled?: boolean
}

export function PermissionModeSwitch({
  mode,
  onChange,
  disabled = false,
}: PermissionModeSwitchProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useShiftTabCycle(mode, onChange, disabled)
  useDismiss(ref, () => setOpen(false), open)

  return (
    <div className="modes" ref={ref}>
      <button
        type="button"
        className={`modes-btn${mode !== PermissionMode.DEFAULT ? ` modes-btn--${mode}` : ''}`}
        data-mode={mode}
        title={`${PERMISSION_MODE_LABEL[mode]} — ${PERMISSION_MODE_HINT[mode]}\n\nShift+Tab: 모드 순환`}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="modes-icon">{PERMISSION_MODE_ICON[mode]}</span>
        <span className="modes-label">{PERMISSION_MODE_LABEL[mode]}</span>
        <span className="modes-caret" />
      </button>

      {open && (
        <div className="modes-menu" role="menu">
          <div className="modes-menu__head">
            <span>MODES</span>
            {/* 단축키가 있다는 걸 알려주지 않으면 아무도 안 쓴다 */}
            <span className="modes-menu__shortcut">⇧ + Tab</span>
          </div>

          {ALL_PERMISSION_MODES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="menuitemradio"
              aria-checked={candidate === mode}
              className={`modes-item${candidate === mode ? ' modes-item--on' : ''}`}
              onClick={() => {
                setOpen(false)
                onChange(candidate)
              }}
            >
              <span className="modes-item__icon">{PERMISSION_MODE_ICON[candidate]}</span>
              <span className="modes-item__body">
                <span className="modes-item__label">{PERMISSION_MODE_LABEL[candidate]}</span>
                <span className="modes-item__desc">{PERMISSION_MODE_HINT[candidate]}</span>
              </span>
              {/* 체크만으로 표시하지 않는다 — 색각 이상·흑백에서 사라진다.
                  --on 이 배경까지 바꾼다. */}
              {candidate === mode && <span className="modes-item__check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 다음 모드. 목록 끝에서 처음으로 돌아온다. */
export function nextMode(current: PermissionMode): PermissionMode {
  const index = ALL_PERMISSION_MODES.indexOf(current)
  return ALL_PERMISSION_MODES[(index + 1) % ALL_PERMISSION_MODES.length] ?? PermissionMode.DEFAULT
}

/**
 * Shift+Tab 순환.
 *
 * 창 전체에서 받는다 — 입력창에 포커스가 있든 없든 동작해야 한다.
 * 기본 탭 이동은 막는다. 안 막으면 포커스가 튀면서 모드도 바뀌어 혼란스럽다.
 */
function useShiftTabCycle(
  mode: PermissionMode,
  onChange: (mode: PermissionMode) => void,
  disabled: boolean,
): void {
  useEffect(() => {
    if (disabled) return

    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !event.shiftKey) return
      event.preventDefault()
      onChange(nextMode(mode))
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mode, onChange, disabled])
}

/** 바깥을 누르거나 Escape 를 누르면 닫는다. mousedown 이어야 여는 클릭이 즉시 닫지 않는다. */
function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return

    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, onDismiss, active])
}
