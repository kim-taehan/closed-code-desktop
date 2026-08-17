import { useEffect, useRef, useState } from 'react'
import { useDismissOnOutsideOrEscape } from '../state/useDismiss'
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
  useDismissOnOutsideOrEscape(ref, () => setOpen(false), open)

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
 * Shift+Tab 순환. **입력창 안에서만 받는다.**
 *
 * 예전에는 창 전체에서 받고 무조건 `preventDefault()` 했다. 그 결과 세션이 붙어 있는
 * 동안(= 평소 내내, `ChatComposer.tsx` 가 `disabled={!ready}` 로 넘긴다) **앱 어디서도
 * ⇧Tab 으로 포커스를 뒤로 못 보냈다.** 브라우저의 역방향 포커스 이동이 통째로 죽어 있었고,
 * 셸 드로어가 생긴 뒤로는 ⇧Tab 이 셸에도 못 간다.
 *
 * 안 고치면: 키보드만 쓰는 사용자가 되돌아갈 길이 없다. 그런데 화면 어디에도 "⇧Tab 이
 * 안 먹는다" 는 표시가 없어서, 자기가 잘못 눌렀다고 여기게 된다.
 *
 * **범위를 입력창으로 좁혀 푼다.** 이 단축키가 광고되는 자리가 거기다 — 버튼 툴팁과
 * 메뉴 머리(`⇧ + Tab`)가 둘 다 입력창 옆에 붙어 있고, 실제 흐름도 "치다가 모드를 바꾸고
 * 보낸다" 이다. 그 밖에서는 손대지 않아 원래 동작(역방향 포커스)이 그대로 남는다.
 *
 * `useShortcuts` 로 옮기지 않았다: 거기의 임자 판정(`borrowed()`)은 Esc·⌘Enter 를 위한
 * 것이라 ⇧Tab 에는 맞지 않고(⇧Tab 은 **언제나** 기본 동작이 있다), 옮겨도 이 판정은
 * 그대로 필요하다. 얻는 것이 자리뿐이라 최소 개입 원칙상 두고 좁혔다.
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
      if (!inComposer(event.target)) return
      event.preventDefault()
      onChange(nextMode(mode))
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mode, onChange, disabled])
}

/**
 * 입력창(그 안의 도구 줄 포함) 안에서 눌렀는가.
 *
 * 태그가 아니라 **컨테이너**로 가른다 — 셸 드로어의 포커스도 숨은 `<textarea>` 라
 * 태그로 보면 둘을 구별할 수 없다 (`_workspace/05_keymap.md` §5.2 와 같은 판단).
 */
function inComposer(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.composer') !== null
}
