import { useEffect, useRef, useState } from 'react'
import { THEMES, THEME_DESC, THEME_LABEL, THEME_SWATCH, type ThemeChoice } from '../state/useTheme'
import { t } from '../i18n/messages'

// 테마 고르기. 생김새는 select 지만 직접 만든다 —
// 네이티브 select 는 항목마다 색 네모를 넣을 수 없다 (option 스타일이 막혀 있다).
//
// 색을 함께 보여주는 이유는 이름만으로는 고르기 전에 어떤 색인지 알 수 없기 때문이다.

export interface ThemeSelectProps {
  value: ThemeChoice
  onChange: (choice: ThemeChoice) => void
}

export function ThemeSelect({ value, onChange }: ThemeSelectProps) {
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
    <div className="dc-select" ref={ref}>
      <button
        type="button"
        className="dc-select__toggle"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('UI 테마')}
      >
        <Swatch colors={THEME_SWATCH[value]} />
        <span className="dc-select__label">{t(THEME_LABEL[value])}</span>
        <span className="dc-select__caret" />
      </button>

      {open && (
        <div className="dc-select__menu" role="listbox">
          {THEMES.map((choice) => (
            <button
              key={choice}
              type="button"
              role="option"
              aria-selected={choice === value}
              className={`dc-select__item${choice === value ? ' dc-select__item--on' : ''}`}
              onClick={() => {
                onChange(choice)
                setOpen(false)
              }}
            >
              <Swatch colors={THEME_SWATCH[choice]} />
              <span className="dc-select__body">
                <span className="dc-select__label">{t(THEME_LABEL[choice])}</span>
                <span className="dc-select__desc">{t(THEME_DESC[choice])}</span>
              </span>
              {choice === value && <span className="dc-select__check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 배경·글자·강조 세 색. 팔레트를 한눈에 알아보게 하는 최소한이다. */
function Swatch({ colors }: { colors: { bg: string; fg: string; accent: string } }) {
  return (
    <span className="dc-swatch" aria-hidden="true">
      <span className="dc-swatch__chip" style={{ background: colors.bg }} />
      <span className="dc-swatch__chip" style={{ background: colors.fg }} />
      <span className="dc-swatch__chip" style={{ background: colors.accent }} />
    </span>
  )
}
