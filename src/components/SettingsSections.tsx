import type { ThemeChoice } from '../state/useTheme'
import { ThemeSelect } from './ThemeSelect'
import { t } from '../i18n/messages'
import { LANGS, LANG_LABEL, type Lang } from '../i18n/messages'

// 설정 창의 오른쪽 내용들. 왼쪽 분류마다 한 덩이씩.
// 창 뼈대(SettingsDialog)와 나눠 둔 이유는 분류가 늘어날 때 여기만 자라기 때문이다.

export interface DisplaySectionProps {
  theme: ThemeChoice
  onTheme: (choice: ThemeChoice) => void
  lang: Lang
  onLang: (lang: Lang) => void
}

export function DisplaySection({ theme, onTheme, lang, onLang }: DisplaySectionProps) {
  return (
    <section className="dc-settings__section">
      <h3 className="dc-settings__heading">{t('화면')}</h3>

      <div className="dc-settings__field">
        <span className="dc-settings__label">{t('UI 테마')}</span>
        <p className="dc-settings__hint dc-settings__hint--above">
          {t('마음에 드는 색을 골라 보세요. 고르는 즉시 화면에 적용됩니다.')}
        </p>
        <ThemeSelect value={theme} onChange={onTheme} />
      </div>

      <div className="dc-settings__field">
        <span className="dc-settings__label">{t('UI 언어')}</span>
        <select
          className="dc-settings__select"
          value={lang}
          onChange={(event) => onLang(event.target.value as Lang)}
          aria-label={t('UI 언어')}
        >
          {LANGS.map((code) => (
            <option key={code} value={code}>
              {LANG_LABEL[code]}
            </option>
          ))}
        </select>
        <p className="dc-settings__hint">{t('고르는 즉시 화면 문구가 바뀝니다.')}</p>
      </div>
    </section>
  )
}
