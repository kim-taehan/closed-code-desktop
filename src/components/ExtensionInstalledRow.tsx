import { useState } from 'react'
import { t } from '../i18n/messages'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'

// 설치된 확장 한 줄 — 켜기/끄기 · 상세 · 삭제.
//
// **지우기는 되돌릴 수 없어 한 번 묻는다.** 대화상자를 새로 만들지 않고 그 줄에서 묻는다 —
// 모달을 띄우면 어느 확장을 지우는지 다시 읽어야 하고, 이 창은 이미 좁다.
//
// 꺼진 확장은 목록에서 지우지 않고 **흐리게** 남긴다. 사라지면 다시 켤 자리가 없다.
//
// 켜기·끄기는 **그 프로젝트에서**다 (`toggleLabel`). 지우기는 앱 전체다 — 설치가 앱 전체라서.
//
// **바깥에 닿는 확장은 그 출처를 이름 밑에 한 줄로 보인다** (매니페스트 `network`) — 켜기가 곧
// 「이 확장이 여기로 나가도 된다」는 결정이라, 스위치를 누르기 전에 보여야 한다 (하이닉스 §5-1).
//
// **「열기」는 웹뷰 뷰(3판)마다 하나다** (확장 재설계 §2-2 진입점 1). 켜진 확장에만 뜬다 —
// 꺼진 프로젝트에서 열면 탭이 사유만 보여 주는 빈 칸이 된다.

export function ExtensionInstalledRow({
  extension,
  toggleLabel,
  onOpenDetail,
  onSetEnabled,
  onUninstall,
  onOpenView,
}: {
  extension: ExtensionEntryPayload
  /** 「이 프로젝트에서 켜기 — 이름」. null 이면 열린 프로젝트가 없어 스위치를 막는다 */
  toggleLabel: string | null
  onOpenDetail: () => void
  onSetEnabled: (enabled: boolean) => void
  onUninstall: () => void
  /** 웹뷰 뷰를 본문 탭으로 연다. 없으면(열린 프로젝트 없음) 「열기」를 안 그린다 */
  onOpenView?: (viewId: string, title: string) => void
}) {
  const webviews = (extension.contributes?.views ?? []).filter((view) => view.kind === 'webview')
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
        {extension.network ? (
          // 한 줄로 잘리므로(`.dc-ext__meta`) 전부는 툴팁에 둔다
          <span className="dc-ext__meta" title={extension.network.join('\n')}>
            {t('연결하는 곳')}: {extension.network.join(', ')}
          </span>
        ) : null}
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
          {extension.enabled && onOpenView
            ? webviews.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  className="dc-ext__btn dc-ext__action"
                  title={`${t('열기')} — ${view.title}`}
                  onClick={() => onOpenView(view.id, view.title)}
                >
                  {webviews.length > 1 ? `${t('열기')} · ${view.title}` : t('열기')}
                </button>
              ))
            : null}
          <input
            type="checkbox"
            className="dc-ext__switch"
            checked={extension.enabled}
            disabled={toggleLabel === null}
            {...(toggleLabel === null ? {} : { title: toggleLabel })}
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
