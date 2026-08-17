import { useRef, useState } from 'react'
import { useDismissOnOutsideOrEscape } from '../state/useDismiss'
import type { LlmModelStatePayload } from '../../shared/protocol/llmConfig'
import { buildModelMenuOptions, displayModel } from '../state/modelSelect'
import { t } from '../i18n/messages'

// 입력창 툴바의 모델 스위처 (DC-1322 미러). PermissionModeSwitch 의 modes-* 를
// 그대로 입어 형제 토글처럼 보이게 한다 (vscode 도 같은 판단 — cc-modes-* 재사용).
// 표시 여부(fail-closed)는 부모(ChatComposer)가 isModelSwitcherEligible 로 정한다.

export interface ModelSwitchProps {
  state: LlmModelStatePayload
  selected: string | null
  onSelect: (model: string | null) => void
  disabled?: boolean
}

export function ModelSwitch({ state, selected, onSelect, disabled = false }: ModelSwitchProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismissOnOutsideOrEscape(ref, () => setOpen(false), open)

  const currentModel = state.status?.model ?? ''
  const options = buildModelMenuOptions(state.options, currentModel)
  const overridden = selected !== null

  return (
    <div className="modes" ref={ref}>
      <button
        type="button"
        className={`modes-btn${overridden ? ' modes-btn--acceptEdits' : ''}`}
        title={
          overridden
            ? `${t('이번 메시지부터')} ${selected} ${t('사용 중')}\n\n/model ${t('로도 전환 가능')}`
            : t('이번 메시지에 한해 다른 모델 사용')
        }
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="modes-label" style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayModel(selected, currentModel)}
        </span>
        <span className="modes-caret" />
      </button>

      {open && (
        <div className="modes-menu" role="menu">
          <div className="modes-menu__head">
            <span>MODEL</span>
            <span className="modes-menu__shortcut">/model</span>
          </div>

          {state.loading && <div className="modes-item">{t('모델 목록을 불러오는 중…')}</div>}
          {!state.loading && state.error && options.length === 0 && (
            <div className="modes-item">{state.error}</div>
          )}
          {!state.loading &&
            options.map((option) => (
              <button
                key={option.model ?? '__default__'}
                type="button"
                role="menuitemradio"
                aria-checked={option.model === selected}
                className={`modes-item${option.model === selected ? ' modes-item--on' : ''}`}
                title={option.label}
                onClick={() => {
                  setOpen(false)
                  onSelect(option.model)
                }}
              >
                <span className="modes-item__body">
                  <span className="modes-item__label">{option.label}</span>
                  {option.model === null && <span className="modes-item__desc">{t('기본 (설정된 모델)')}</span>}
                </span>
                {option.model === selected && <span className="modes-item__check">✓</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
