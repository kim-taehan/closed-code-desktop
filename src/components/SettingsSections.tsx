import type { ThemeChoice } from '../state/useTheme'
import type { AppSettings } from '../../shared/settings/appSettings'
import { ThemeSelect } from './ThemeSelect'
import { SettingsToggle } from './SettingsToggle'
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

export interface AgentSectionProps {
  settings: AppSettings
  onSave: (settings: AppSettings) => void
}

/**
 * 에이전트가 이 앱을 조작하게 열어 두는 문의 스위치 (`electron/mcp/`).
 *
 * ⚠️ 설정 창의 「연결」 아래에 있는 **개인 MCP 자격**(`McpDialog`)과 다른 것이다.
 * 저쪽은 앱이 MCP 클라이언트로서 남의 서버에 붙는 이야기이고, 이쪽은 앱이 MCP
 * **서버**가 되는 이야기다. 문구에서 그 차이가 드러나야 사용자가 헷갈리지 않는다.
 *
 * 끌 수 있어야 하는 이유를 힌트에 적는다 — 등록 대상이 **사용자가 띄운 공용 서버**라,
 * 같은 프로젝트 폴더로 그 서버에 붙은 다른 클라이언트도 이 도구를 본다.
 */
export function AgentSection({ settings, onSave }: AgentSectionProps) {
  return (
    <section className="dc-settings__section">
      <h3 className="dc-settings__heading">{t('에이전트 연동')}</h3>

      <SettingsToggle
        label={t('내 화면을 에이전트에게 열어 주기')}
        hint={t(
          '프로젝트가 opencode 에 붙을 때 이 앱을 도구로 등록합니다. 에이전트가 "지금 뭐 보고 있어?" 에 답하거나 파일을 화면에 띄울 수 있게 됩니다. 서버는 127.0.0.1 에만 열리고 토큰은 앱을 켤 때마다 새로 만듭니다. 다만 같은 프로젝트 폴더로 그 opencode 서버에 붙은 다른 클라이언트에게도 이 도구가 보입니다.',
        )}
        checked={settings.desktopMcp}
        onChange={(value) => onSave({ ...settings, desktopMcp: value })}
      />

      {/* 켜는 사람이 무엇을 기대해야 하는지 알아야 한다. **우리 쪽 결함이 아니므로**
          "안 됩니다" 가 아니라 "지금 버전에서는 아직 안 씁니다" 로 적는다 —
          근거는 `shared/settings/appSettings.ts` 의 `DEFAULT_DESKTOP_MCP` 주석. */}
      <p className="dc-settings__hint">
        {t(
          '지금 확인된 opencode 버전(1.17·1.18)에서는 등록까지만 되고 모델이 이 도구를 아직 받아 가지 않습니다 — 켜 두어도 에이전트 쪽 동작은 달라지지 않습니다. opencode 가 이 도구를 싣기 시작하면 설정을 바꾸지 않아도 바로 동작합니다.',
        )}
      </p>
    </section>
  )
}
