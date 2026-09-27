import type { AppSettings } from '../../shared/settings/appSettings'
import { SettingsToggle } from './SettingsToggle'
import { t } from '../i18n/messages'

// 원격(휴대폰) 설정 — 계획 §12 #4·5 의 사용자 결정이 이 화면이다: **선택 기능이고 기본 꺼짐.**
//
// 켜는 것이 언제나 사용자의 손이어야 하는 이유는 켜면 코드·대화가 PC 밖으로 나가기 때문이다
// (보안 심사 항목 T6). 그래서 두 스위치를 갈라 뒀다 — 보는 것과 **답하는 것**은 다르다.
// 답하기는 PC 에서 명령을 실행하는 것이라 따로 켜야 한다 (계획 §3).
//
// ⚠️ 지금은 **전송이 없어서** 켜도 휴대폰이 붙을 자리가 없다 (`electron/remote/link.ts`:
// BLE 는 다음 몫). 그래도 스위치를 먼저 두는 이유는 기본값이 「꺼짐」이라는 것 자체가 계약이고,
// 전송이 붙는 순간 광고를 할지 말지가 이 값에 달려 있기 때문이다.

export interface RemoteSectionProps {
  settings: AppSettings
  onSave: (settings: AppSettings) => void
}

export function RemoteSection({ settings, onSave }: RemoteSectionProps) {
  const set = (patch: Partial<AppSettings>) => onSave({ ...settings, ...patch })

  return (
    <section className="dc-settings__section">
      <h3 className="dc-settings__heading">{t('원격 (휴대폰)')}</h3>

      <SettingsToggle
        label={t('원격 허용')}
        hint={t('휴대폰이 블루투스로 붙어 대화를 볼 수 있게 합니다. 꺼 두면 광고도 하지 않습니다.')}
        checked={settings.remoteEnabled}
        onChange={(value) => set({ remoteEnabled: value })}
      />

      <SettingsToggle
        label={t('휴대폰에서 승인 응답 허용')}
        hint={t('휴대폰이 도구 승인·질문·계획에 답할 수 있게 합니다. 이 PC 에서 명령이 실행됩니다.')}
        checked={settings.remoteApprovals}
        onChange={(value) => set({ remoteApprovals: value })}
      />
    </section>
  )
}
