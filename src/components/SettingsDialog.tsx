import { useState } from 'react'
import type { ThemeChoice } from '../state/useTheme'
import type { AppSettings } from '../../shared/settings/appSettings'
import { AgentSection, DisplaySection } from './SettingsSections'
import { NotifySection } from './NotifySection'
import { ShortcutsSection } from './ShortcutsSection'
import { ExtensionsSection } from './ExtensionsSection'
import { t } from '../i18n/messages'
import { useLang } from '../state/useLang'

// 설정 창 — 왼쪽 분류, 오른쪽 내용.
//
// 설계 §6 은 "설정 화면을 만들지 않는다" 였다. 그때는 넣을 것이 테마 하나뿐이었다.
// 항목이 늘며 창이 됐다. **채울 수 있는 분류만 둔다** — 눌러도 빈 화면이 나오는 항목은 없다.
//
// 연결(주소·키·포트)은 여기 없다 — "프로젝트 연결" 팝업이 유일한 자리다
// (진단·수정·연결 시도가 한 화면이어야 왕복이 없다, 사용자 결정 2026-07-23).

export type SettingsSection = 'display' | 'notify' | 'agent' | 'shortcuts' | 'extensions'

// 라벨은 렌더 시점에 t() 로 뽑는다 — 언어를 바꾸면 즉시 반영돼야 하므로 상수로 굳히지 않는다.
// `badge` 는 아직 다 여물지 않은 기능임을 분류 옆에 밝히는 표시다. 기능이 서면 뗀다.
const SECTIONS: { id: SettingsSection; label: string; badge?: string }[] = [
  { id: 'display', label: '화면' },
  { id: 'notify', label: '알림' },
  { id: 'agent', label: '에이전트 연동' },
  { id: 'shortcuts', label: '단축키' },
  { id: 'extensions', label: '확장', badge: '베타' },
]

export interface SettingsDialogProps {
  theme: ThemeChoice
  onTheme: (choice: ThemeChoice) => void
  settings: AppSettings
  /** 저장 완료를 기다릴 수 있다 (useAppSettings.save 와 같은 계약) */
  onSaveSettings: (settings: AppSettings) => Promise<void>
  onClose: () => void
  /** 열자마자 보여줄 분류 */
  initialSection?: SettingsSection
}

export function SettingsDialog(props: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>(props.initialSection ?? 'display')
  // 언어 선택기 바인딩. 정본은 appSettings.language 이며 저장 경로(onSaveSettings)를 그대로 탄다.
  const lang = useLang({ value: props.settings, save: props.onSaveSettings })

  return (
    <div className="dc-modal" role="dialog" aria-label={t('설정')} onClick={props.onClose}>
      <div className="dc-settings" onClick={(event) => event.stopPropagation()}>
        <div className="dc-settings__head">
          <span className="dc-settings__title">{t('AXGentic Code 설정')}</span>
          <button type="button" className="dc-modal__close" onClick={props.onClose} title={t('닫기')}>
            ×
          </button>
        </div>

        <div className="dc-settings__body">
          <nav className="dc-settings__nav" aria-label={t('설정 분류')}>
            {SECTIONS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-current={candidate.id === section}
                className={`dc-settings__navitem${
                  candidate.id === section ? ' dc-settings__navitem--on' : ''
                }`}
                onClick={() => setSection(candidate.id)}
              >
                {t(candidate.label)}
                {candidate.badge ? (
                  <span className="dc-settings__navbadge">{t(candidate.badge)}</span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="dc-settings__pane">
            {section === 'display' && (
              <DisplaySection
                theme={props.theme}
                onTheme={props.onTheme}
                lang={lang.lang}
                onLang={lang.setLang}
              />
            )}
            {section === 'notify' && (
              <NotifySection settings={props.settings} onSave={props.onSaveSettings} />
            )}
            {section === 'agent' && (
              <AgentSection settings={props.settings} onSave={props.onSaveSettings} />
            )}
            {section === 'shortcuts' && (
              <ShortcutsSection developerMode={props.settings.developerMode} />
            )}
            {section === 'extensions' && <ExtensionsSection />}
          </div>
        </div>
      </div>
    </div>
  )
}
