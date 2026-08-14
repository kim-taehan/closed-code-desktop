import { t } from '../i18n/messages'

// 연결 열 — 이 프로젝트가 쓰는 서버가 어디인지와 버튼 하나.
//
// **칸이 셋 → 하나 → 영이 됐다.** davis 때는 Backend URL(Admin 서버)·라이선스 키·시작 포트
// 셋을 받았다. opencode 로 옮기며 중앙 서버도 라이선스도 없어져 **서버 주소 하나**만 남았고,
// 이제 그것도 없다 — **서버는 프로젝트마다 앱이 직접 띄운다**
// (`electron/opencode/serverPool.ts`). 사용자가 정할 값이 하나도 남지 않았다.
//
// 그래서 이 자리는 **고치는 곳이 아니라 보여 주는 곳**이 됐다. 주소를 그대로 띄우는 이유:
// 프로젝트마다 포트가 다르고(우리가 고르지 않는다) 무엇에 붙어 있는지가 곧 진단이다.
// 사람이 캡처해서 묻는 화면이라 여기 찍혀 있으면 되묻지 않아도 된다.
//
// **"연결 시도" 하나가 재연결 + 자가 진단 전부다** — 저장할 것이 없어져 이름만 남았다.
// 붙었는지 확인하는 일은 이 폼이 하지 않는다 — 옆 열의 자가 진단(파이프라인)이 전부 맡는다.

export interface ConnectionFixFormProps {
  /** 지금 붙어 있는(또는 붙으려던) 서버. 아직 안 떴으면 null */
  endpoint: { host: string; port: number } | null
  /** 옆 열의 자가 진단이 도는 중 — 버튼을 잠그고 진행 중임을 알린다 */
  running: boolean
  /** 다시 확인하라 — 호출한 쪽이 진단을 처음부터 다시 돌린다 */
  onApply: () => void
}

export function ConnectionFixForm({ endpoint, running, onApply }: ConnectionFixFormProps) {
  return (
    <>
      <div className="dc-settings__field">
        <span className="dc-settings__label">
          {t('opencode 서버')}
          <span className="dc-settings__scope">{t('이 프로젝트')}</span>
        </span>
        <p className="dc-settings__hint">
          {endpoint === null
            ? t('아직 뜨지 않았습니다. 프로젝트를 열면 이 프로젝트의 서버를 띄웁니다.')
            : `http://${endpoint.host}:${endpoint.port}`}
        </p>
      </div>

      <p className="dc-settings__hint">
        {t('모델·키는 이 앱이 아니라 opencode 설정(~/.config/opencode/opencode.json)에서 정합니다.')}
      </p>

      <div className="dc-modal__actions">
        <button
          type="button"
          className="dc-settings__apply dc-settings__apply--urge"
          disabled={running}
          onClick={onApply}
        >
          {running && <span className="dc-spinner" aria-hidden="true" />}
          {running ? t('진단 중…') : t('연결 시도')}
        </button>
      </div>
    </>
  )
}
