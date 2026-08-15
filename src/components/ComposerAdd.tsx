import { useEffect, useRef, useState } from 'react'
import { setOpenConnectorsHandler } from '../state/slashCommands'

// 입력창 왼쪽 "+" 메뉴.
//
// 첨부·스킬·커넥터를 고른다.
//
// `/mcps` 도 커넥터 다이얼로그를 연다. 그 손잡이(`onConnectors`)를 쥔 곳이 여기라 여기서
// 심는다 — AppMenu 가 `/logs` 를 심는 것과 같은 구조다. `disabled` 여도 심는 것은 그대로다:
// 슬래시를 칠 수 있다는 것이 곧 입력창이 살아 있다는 뜻이라 따로 가릴 것이 없다.

export function ComposerAdd({
  disabled = false,
  onPick,
  onSkills,
  onConnectors,
}: {
  disabled?: boolean
  onPick: () => void
  onSkills: () => void
  onConnectors: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 매 렌더 다시 심는다 — 부모가 새 클로저를 주면 옛것이 남아 엉뚱한 창을 연다
  useEffect(() => {
    setOpenConnectorsHandler(onConnectors)
    return () => setOpenConnectorsHandler(null)
  }, [onConnectors])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="composer-add" ref={ref}>
      <button
        type="button"
        className="composer-add__toggle"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        title="추가"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        +
      </button>

      {open && (
        <div className="composer-add__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="composer-add__item"
            onClick={() => {
              onPick()
              setOpen(false)
            }}
          >
            <span className="composer-add__icon">📎</span>
            파일 또는 이미지 추가
          </button>

          <button
            type="button"
            role="menuitem"
            className="composer-add__item"
            onClick={() => {
              onSkills()
              setOpen(false)
            }}
          >
            <span className="composer-add__icon">📜</span>
            스킬
          </button>

          <button
            type="button"
            role="menuitem"
            className="composer-add__item"
            onClick={() => {
              onConnectors()
              setOpen(false)
            }}
          >
            <span className="composer-add__icon">🔌</span>
            커넥터
          </button>
        </div>
      )}
    </div>
  )
}
