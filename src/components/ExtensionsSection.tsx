import { useState } from 'react'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'
import { t } from '../i18n/messages'
import { useExtensionList } from '../state/useExtensionList'
import { SKIP_REASON_LABEL } from '../state/extensionSkipReason'
import { ExtensionRegistryTab } from './ExtensionRegistryTab'
import { ExtensionDetail } from './ExtensionDetail'
import { ExtensionInstalledRow } from './ExtensionInstalledRow'
import '../styles/extensions.css'

// 설정 창의 "확장" 분류 — 확장 프로그램을 받고 켜고 끄는 자리.
//
// 배포처에서 목록을 조회하고 골라 받는다. 설치가 끝나면 설치 목록을 **다시 읽어**
// 행 상태(설치/업데이트/설치됨)를 맞춘다 — 배포처가 적은 이름·버전과 패키지 안
// 매니페스트가 어긋날 수 있어, 배포처 말만 믿고 그리면 실제 설치본과 달라진다.
//
// 화면 골격의 근거는 `docs/reference/extension-standard.md` 다.
//
// 1. **배포처와 설치본을 가른다.** 할 수 있는 일이 다르다 — 앞은 받기,
//    뒤는 켜기·끄기·삭제. 한 목록에 섞으면 행마다 버튼이 달라져 읽기 어려워진다.
// 2. **상세 창을 두지 않는다.** 설정 창 내용 영역이 540px 이라 목록·상세를
//    좌우로 가르면 양쪽 다 좁다. 대신 한 줄에 "무엇을 하는 확장인지" 를 싣는다.

type ExtensionTab = 'registry' | 'installed'

const TABS: { id: ExtensionTab; label: string }[] = [
  { id: 'registry', label: '배포처' },
  { id: 'installed', label: '설치됨' },
]

export function ExtensionsSection() {
  // 설치됨이 기본이다 — 대개 가진 것을 확인하러 온다
  const [tab, setTab] = useState<ExtensionTab>('installed')
  // 탭과 무관하게 훑는다 — 배포처 탭도 행마다 설치 상태(설치/업데이트/설치됨)를 판정하려면
  // 설치 목록이 있어야 한다. 이 분류를 열었을 때만 마운트되므로 훑기가 새지 않는다
  const list = useExtensionList(true)
  // 상세를 열면 목록을 갈아끼운다 — 좌우로 가르기엔 내용 영역이 좁다
  const [detail, setDetail] = useState<ExtensionEntryPayload | null>(null)

  if (detail !== null) {
    return (
      <section className="dc-settings__section">
        <h3 className="dc-settings__heading">{t('확장')}</h3>
        <ExtensionDetail extension={detail} onBack={() => setDetail(null)} />
      </section>
    )
  }

  return (
    <section className="dc-settings__section">
      <h3 className="dc-settings__heading">{t('확장')}</h3>

      <p className="dc-settings__hint dc-settings__hint--above">
        {t('폐쇄망에서는 사내 배포처 주소나 내려받은 패키지로 확장을 설치합니다.')}
      </p>

      <div className="dc-ext__tabs" role="tablist" aria-label={t('확장 분류')}>
        {TABS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={candidate.id === tab}
            className={`dc-ext__tab${candidate.id === tab ? ' dc-ext__tab--on' : ''}`}
            onClick={() => setTab(candidate.id)}
          >
            {t(candidate.label)}
            {candidate.id === 'installed' && list.extensions.length > 0 ? (
              <span className="dc-ext__count">{list.extensions.length}</span>
            ) : null}
          </button>
        ))}
        <span className="dc-ext__tabfill" />
        <button
          type="button"
          className="dc-ext__btn"
          disabled={list.installing}
          onClick={list.installFromDisk}
        >
          {list.installing ? t('설치 중…') : t('디스크에서 설치…')}
        </button>
      </div>

      {list.notice !== null && <p className="dc-ext__notice">{list.notice}</p>}

      {tab === 'registry' ? (
        <ExtensionRegistryTab installed={list.extensions} onInstalled={list.refresh} />
      ) : (
        <InstalledTab list={list} onOpenDetail={setDetail} />
      )}
    </section>
  )
}

/** 설치됨 — 이미 가진 것. 건너뛴 것도 사유와 함께 보여준다. */
function InstalledTab({
  list,
  onOpenDetail,
}: {
  list: ReturnType<typeof useExtensionList>
  onOpenDetail: (extension: ExtensionEntryPayload) => void
}) {
  const empty = list.extensions.length === 0 && list.skipped.length === 0

  return (
    <div className="dc-ext__tabpanel" role="tabpanel">
      {list.loading && empty ? (
        <p className="dc-ext__empty">{t('불러오는 중…')}</p>
      ) : empty ? (
        <p className="dc-ext__empty">
          {t('아직 설치한 확장이 없습니다.')}
          <br />
          {t('내려받은 패키지를 디스크에서 설치하세요.')}
        </p>
      ) : (
        <>
          <ul className="dc-ext__list">
            {list.extensions.map((extension) => (
              <ExtensionInstalledRow
                key={extension.dir}
                extension={extension}
                onOpenDetail={() => onOpenDetail(extension)}
                onSetEnabled={(enabled) => list.setEnabled(extension.name, enabled)}
                onUninstall={() => list.uninstall(extension.dir)}
              />
            ))}
          </ul>

          {/* 건너뛴 것을 감추지 않는다 — 설치했는데 목록에 없으면 원인을 알 수 없다 */}
          {list.skipped.length > 0 && (
            <>
              <p className="dc-ext__skiphead">{t('건너뜀')}</p>
              <ul className="dc-ext__list">
                {list.skipped.map((item) => (
                  <li key={item.dir} className="dc-ext__row dc-ext__row--bad">
                    <span className="dc-ext__icon" aria-hidden="true">
                      !
                    </span>
                    <span className="dc-ext__body">
                      <span className="dc-ext__name">{dirName(item.dir)}</span>
                      <span className="dc-ext__meta">{describeSkip(item.reason)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** 설치 폴더 이름만. 전체 경로는 좁은 화면에서 앞이 잘려 무엇인지 알 수 없다. */
function dirName(dir: string): string {
  const parts = dir.split(/[/\\]/).filter((part) => part !== '')
  return parts[parts.length - 1] ?? dir
}

/** 모르는 사유는 코드를 그대로 보여준다. 감추면 사용자가 고칠 수 없다. */
function describeSkip(reason: string): string {
  return SKIP_REASON_LABEL[reason] ?? t('알 수 없는 사유') + ` (${reason})`
}
