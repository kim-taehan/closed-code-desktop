import { useState } from 'react'
import { DEFAULT_OPENCODE_URL, type AppSettings } from '../../shared/settings/appSettings'
import { t } from '../i18n/messages'

// 연결 설정 폼 — 연결에 관한 값 전부와 버튼 하나.
//
// **opencode 전환으로 칸이 셋에서 하나로 줄었다.** davis 때는 Backend URL(Admin 서버) ·
// 라이선스 키 · 시작 포트 셋을 받았는데, opencode 에는 중앙 서버도 라이선스도 없고
// 포트 탐색도 없다(사용자가 띄운 한 곳에 붙는다). 키·사용량·모델 접근 제어는 LLM 프록시 몫이다.
// 그래서 이 앱이 알아야 하는 값은 **opencode 서버 주소 하나**뿐이다.
//
// **"연결 시도" 하나가 저장 + 재연결 + 자가 진단 전부다** — 저장 버튼도, "다시 진단" 버튼도
// 따로 없다. 이 버튼을 누르는 건 뭔가 문제가 있을 때이고, 그때 필요한 건 늘
// "바뀐 값 반영 + 처음부터 다시 확인" 하나뿐이라 나눠 둘 이유가 없다.
// 붙었는지 확인하는 일은 이 폼이 하지 않는다 — 옆 열의 자가 진단(파이프라인)이 전부 맡는다.

export interface ConnectionFixFormProps {
  settings: AppSettings
  /** 저장 완료를 기다린다 — 저장 전에 재연결하면 옛 주소로 붙는다 */
  onSaveSettings: (settings: AppSettings) => Promise<void>
  /** 옆 열의 자가 진단이 도는 중 — 버튼을 잠그고 진행 중임을 알린다 */
  running: boolean
  /** 값을 반영했다 — 호출한 쪽이 진단을 처음부터 다시 돌린다 */
  onApply: () => void
}

function urlValid(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return true // 비우면 기본값을 쓴다
  try {
    const { protocol } = new URL(trimmed)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function ConnectionFixForm({ settings, onSaveSettings, running, onApply }: ConnectionFixFormProps) {
  const [url, setUrl] = useState(settings.opencodeUrl)
  const [saving, setSaving] = useState(false)

  const valid = urlValid(url)
  const busy = saving || running

  /** 바뀐 값만 저장하고 진단을 다시 돌린다. 바뀐 게 없으면 진단만 다시 돈다(재검증). */
  async function attempt(): Promise<void> {
    setSaving(true)
    try {
      // 빈 값은 기본값으로 정규화해 저장한다 — 소비처가 "빈 문자열" 분기를 갖지 않게.
      const next = url.trim() || DEFAULT_OPENCODE_URL
      if (next !== settings.opencodeUrl) {
        await onSaveSettings({ ...settings, opencodeUrl: next })
      }
    } finally {
      setSaving(false)
    }
    // 재연결은 여기서 부르지 않는다 — 진단이 세션이 죽은 걸 보면 알아서 붙인다.
    // 멀쩡히 붙어 있으면 끊지 않고 검증만 다시 한다.
    onApply()
  }

  return (
    <>
      <div className="dc-settings__field">
        <span className="dc-settings__label">
          {t('opencode 서버')}
          <span className="dc-settings__scope">{t('앱 전체')}</span>
        </span>
        <input
          className={`dc-settings__input${valid ? '' : ' dc-settings__input--bad'}`}
          value={url}
          placeholder={DEFAULT_OPENCODE_URL}
          onChange={(event) => setUrl(event.target.value)}
          aria-label={t('opencode 서버')}
        />
        <p className="dc-settings__hint">
          {valid
            ? `${t('헤드리스 서버 주소입니다. 비우면')} ${DEFAULT_OPENCODE_URL} ${t('을 씁니다.')}`
            : t('http:// 또는 https:// 로 시작하는 주소여야 합니다.')}
        </p>
      </div>

      <p className="dc-settings__hint">
        {t('모델·키는 이 앱이 아니라 opencode 설정(~/.config/opencode/opencode.json)에서 정합니다.')}
      </p>

      <div className="dc-modal__actions">
        <button
          type="button"
          className="dc-settings__apply dc-settings__apply--urge"
          disabled={busy || !valid}
          onClick={() => void attempt()}
        >
          {busy && <span className="dc-spinner" aria-hidden="true" />}
          {saving ? t('저장 중…') : running ? t('진단 중…') : t('연결 시도')}
        </button>
      </div>
    </>
  )
}
