import { t } from '../i18n/messages'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'
import { useExtensionReadme } from '../state/useExtensionReadme'
import { ReadmeView } from './ReadmeView'

// **설치된** 확장 하나의 상세 — 디스크의 README.md 를 그린다.
// 배포처에서 받기 전에 보는 상세는 `ExtensionRegistryDetail` 이다.
//
// **목록을 갈아끼운다.** 설정 창 내용 영역이 540px 이라 목록·상세를 좌우로 가르면
// 양쪽 다 좁고(`ExtensionsSection.tsx` 머리말), 인라인으로 펼치면 README 가 길 때
// 아래 목록이 저 멀리 밀린다.

export interface ExtensionDetailProps {
  extension: ExtensionEntryPayload
  onBack: () => void
}

export function ExtensionDetail({ extension, onBack }: ExtensionDetailProps) {
  const readme = useExtensionReadme(extension.name)

  return (
    <div className="dc-ext__detail">
      <div className="dc-ext__detailbar">
        <button type="button" className="dc-ext__btn" onClick={onBack}>
          {t('← 목록')}
        </button>
        <span className="dc-ext__detailname">{extension.displayName}</span>
        <span className="dc-ext__detailver">{extension.version}</span>
      </div>

      {/* 설치 위치를 늘 보여준다 — 폴더째 복사·심링크로도 설치되므로 어디 것인지가 실제 정보다 */}
      <p className="dc-ext__detailpath" title={extension.dir}>
        {extension.dir}
      </p>

      <ReadmeView state={readme} noneHint={t('확장 폴더에 README.md 를 두면 여기 보입니다.')} />
    </div>
  )
}
