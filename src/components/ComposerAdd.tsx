import { useEffect, useRef, useState } from 'react'

// 입력창 왼쪽 "+" 메뉴.
//
// 첨부·스킬·커넥터를 고른다.

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
