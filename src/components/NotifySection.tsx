import type { AppSettings } from '../../shared/settings/appSettings'
import { SettingsToggle } from './SettingsToggle'
import { t } from '../i18n/messages'

// 알림 설정 — OS 알림.
//
// 업데이트 화면 안에 얹혀 있었는데 업데이트와 아무 상관이 없어 갈라냈다 (사용자 지시).

export interface NotifySectionProps {
  settings: AppSettings
  onSave: (settings: AppSettings) => void
}

export function NotifySection({ settings, onSave }: NotifySectionProps) {
  const set = (patch: Partial<AppSettings>) => onSave({ ...settings, ...patch })

  return (
    <section className="dc-settings__section">
      <h3 className="dc-settings__heading">{t('알림')}</h3>

      <SettingsToggle
        label={t('작업 완료 알림 (백그라운드)')}
        hint={t('창이 비활성일 때 작업이 끝나면 OS 알림을 띄웁니다.')}
        checked={settings.taskDoneNotify}
        onChange={(value) => set({ taskDoneNotify: value })}
      />
    </section>
  )
}
