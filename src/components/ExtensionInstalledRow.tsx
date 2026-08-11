import { useState } from 'react'
import { t } from '../i18n/messages'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'

// 설치된 확장 한 줄 — 켜기/끄기 · 상세 · 삭제.
//
// **지우기는 되돌릴 수 없어 한 번 묻는다.** 대화상자를 새로 만들지 않고 그 줄에서 묻는다 —
// 모달을 띄우면 어느 확장을 지우는지 다시 읽어야 하고, 이 창은 이미 좁다.
//
// 꺼진 확장은 목록에서 지우지 않고 **흐리게** 남긴다. 사라지면 다시 켤 자리가 없다.

export function ExtensionInstalledRow({
  extension,
  onOpenDetail,
  onSetEnabled,
  onUninstall,
}: {
  extension: ExtensionEntryPayload
  onOpenDetail: () => void
  onSetEnabled: (enabled: boolean) => void
  onUninstall: () => void
}) {
  const [asking, setAsking] = useState(false)

  return (
    <li className={`dc-ext__row${extension.enabled ? '' : ' dc-ext__row--off'}`}>
      <span className="dc-ext__icon" aria-hidden="true">
        {extension.displayName.slice(0, 1)}
      </span>
      <span className="dc-ext__body">
        <span className="dc-ext__name">{extension.displayName}</span>
        <span className="dc-ext__meta">
          {extension.description ?? extension.name} · {extension.version}
          {extension.enabled ? '' : ` · ${t('꺼짐')}`}
        </span>
      </span>

      {asking ? (
        <>
          <span className="dc-ext__ask">{t('지울까요?')}</span>
          <button type="button" className="dc-ext__btn dc-ext__btn--danger" onClick={onUninstall}>
            {t('지우기')}
          </button>
          <button type="button" className="dc-ext__btn" onClick={() => setAsking(false)}>
            {t('취소')}
          </button>
        </>
      ) : (
        <>
          <input
            type="checkbox"
            className="dc-ext__switch"
            checked={extension.enabled}
            aria-label={`${extension.displayName} ${t('켜기')}`}
            onChange={(event) => onSetEnabled(event.target.checked)}
          />
          {/* README 가 없는 확장이 대부분이지만 버튼은 늘 둔다 — 없어지면
              상세가 있는지 없는지 눌러보기 전엔 알 수 없다 */}
          <button type="button" className="dc-ext__btn dc-ext__action" onClick={onOpenDetail}>
            {t('상세')}
          </button>
          <button type="button" className="dc-ext__btn" onClick={() => setAsking(true)}>
            {t('삭제')}
          </button>
        </>
      )}
    </li>
  )
}
