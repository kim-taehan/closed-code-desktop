import { t } from '../i18n/messages'
import type { RegistryRow } from '../state/useExtensionRegistry'
import { useRegistryReadme } from '../state/useRegistryReadme'
import { ReadmeView } from './ReadmeView'

// 배포처의 한 줄을 **받기 전에** 들여다보는 자리 (표준 §4.4).
//
// 설치본 상세(`ExtensionDetail`)와 같은 골격이다 — 같은 글이 받기 전과 받은 뒤에 다르게
// 보이면 사용자가 무엇이 달라졌는지 알 수 없다. 다른 것은 두 가지뿐이다:
// 설치 위치 대신 **어느 배포처의 무슨 버전인지**를 싣고, 여기서 바로 받을 수 있다.
//
// 설명은 **패키지를 받지 않고** 목록 문서가 준 주소에서만 가져온다. 안 받을 수도 있는
// 것을 미리 받으면 폐쇄망 회선이 아깝다.

export function ExtensionRegistryDetail({
  row,
  actionLabel,
  actionDisabled,
  onInstall,
  onBack,
}: {
  row: RegistryRow
  actionLabel: string
  actionDisabled: boolean
  onInstall: () => void
  onBack: () => void
}) {
  const { entry } = row
  // `latest` 가 `versions` 에 있는 것은 파서가 보장한다 (`registryIndex.ts` 의 missing_latest)
  const picked = entry.versions.find((item) => item.version === entry.latest)!
  const readme = useRegistryReadme(picked.readme)

  return (
    <div className="dc-ext__detail">
      <div className="dc-ext__detailbar">
        <button type="button" className="dc-ext__btn" onClick={onBack}>
          {t('← 목록')}
        </button>
        <span className="dc-ext__detailname">{entry.displayName}</span>
        <span className="dc-ext__detailver">{entry.latest}</span>
        <button
          type="button"
          className="dc-ext__btn dc-ext__action"
          disabled={actionDisabled}
          onClick={onInstall}
        >
          {actionLabel}
        </button>
      </div>

      {/* 어느 배포처의 것인지 늘 보여준다 — 같은 확장을 여러 곳이 줄 수 있다 */}
      <p className="dc-ext__detailpath" title={picked.url}>
        {row.registryName}
      </p>

      <ReadmeView state={readme} noneHint={t('이 배포처는 설명을 내놓지 않았습니다.')} />
    </div>
  )
}
