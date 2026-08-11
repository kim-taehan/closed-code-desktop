// 설정 화면의 체크 한 줄 (라벨 + 설명). 업데이트·알림 화면이 같이 쓴다.

export interface SettingsToggleProps {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}

export function SettingsToggle({ label, hint, checked, onChange }: SettingsToggleProps) {
  return (
    <div className="dc-settings__field">
      <label className="dc-settings__toggle">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="dc-settings__togglelabel">{label}</span>
      </label>
      <p className="dc-settings__hint">{hint}</p>
    </div>
  )
}
