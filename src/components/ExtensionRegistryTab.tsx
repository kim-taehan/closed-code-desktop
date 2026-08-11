import { useState } from 'react'
import { t } from '../i18n/messages'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'
import { registryRowState, type RegistryRowState } from '../../shared/extensions/registryRowState'
import { useExtensionRegistry, type RegistryRow } from '../state/useExtensionRegistry'
import { useRegistryInstall } from '../state/useRegistryInstall'
import { ExtensionRegistryDetail } from './ExtensionRegistryDetail'

// 설정 창 "확장 → 배포처" — 사내 배포처에서 받을 수 있는 것을 훑고 받아 오는 자리.
//
// 배포처 주소를 다루는 자리를 **접어 둔다.** 평소에 쓰는 일(무엇이 있나 보기)과
// 가끔 쓰는 일(주소 등록)을 같은 높이에 두면 좁은 설정 창에서 목록이 밀린다.
//
// 설치 중에는 **그 줄만** 잠근다. 배포처가 여러 개면 다른 확장을 받는 동안 목록 전체가
// 굳을 이유가 없다. 다만 같은 줄을 두 번 누르면 같은 폴더에 두 번 풀리므로 그 줄은 막는다.

const STATE_LABEL: Record<RegistryRowState, string> = {
  installable: '설치',
  updatable: '업데이트',
  installed: '설치됨',
}

/** 목록의 한 줄을 가리키는 열쇠. 같은 확장을 여러 배포처가 줄 수 있어 주소를 함께 쓴다. */
function rowKey(row: RegistryRow): string {
  return `${row.url}\n${row.entry.name}`
}

export function ExtensionRegistryTab({
  installed,
  onInstalled,
}: {
  installed: ExtensionEntryPayload[]
  /** 설치가 끝났다. 부모가 설치 목록을 다시 읽어 행 상태(설치/업데이트/설치됨)를 맞춘다 */
  onInstalled?: () => void
}) {
  const registry = useExtensionRegistry(true)
  const [managing, setManaging] = useState(false)
  // 상세를 열면 목록을 갈아끼운다 — 설치됨 탭과 같은 규칙(내용 영역이 540px 이라 좁다)
  const [detail, setDetail] = useState<RegistryRow | null>(null)
  const install = useRegistryInstall(onInstalled)

  if (detail !== null) {
    const state = registryRowState(detail.entry, installed)
    const busy = install.busy === rowKey(detail)
    return (
      <div className="dc-ext__tabpanel" role="tabpanel">
        {install.notice !== null && <p className="dc-ext__notice">{install.notice}</p>}
        <ExtensionRegistryDetail
          row={detail}
          actionLabel={busy ? t('받는 중…') : t(STATE_LABEL[state])}
          actionDisabled={state === 'installed' || busy}
          onInstall={() => install.run(detail)}
          onBack={() => setDetail(null)}
        />
      </div>
    )
  }

  return (
    <div className="dc-ext__tabpanel" role="tabpanel">
      <div className="dc-ext__bar">
        <select
          className="dc-ext__select"
          aria-label={t('배포처 고르기')}
          disabled={registry.urls.length === 0}
          value={registry.selected ?? ''}
          onChange={(event) => registry.select(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">
            {registry.urls.length === 0
              ? t('등록한 배포처 없음')
              : `${t('전체 배포처')} (${registry.urls.length})`}
          </option>
          {registry.urls.map((url) => (
            <option key={url} value={url}>
              {registry.namesByUrl[url] ?? url}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="dc-ext__btn"
          disabled={registry.urls.length === 0 || registry.loading}
          onClick={registry.refresh}
        >
          {registry.loading ? t('조회 중…') : t('다시 조회')}
        </button>
        <button
          type="button"
          className="dc-ext__btn"
          aria-expanded={managing}
          onClick={() => setManaging((open) => !open)}
        >
          {t('배포처 관리…')}
        </button>
      </div>

      {managing && <ManagePanel registry={registry} />}

      {install.notice !== null && <p className="dc-ext__notice">{install.notice}</p>}

      {registry.urls.length === 0 ? (
        <p className="dc-ext__empty">
          {t('등록한 배포처가 없습니다.')}
          <br />
          {t('“배포처 관리…” 에서 목록 문서(index.json)의 전체 주소를 넣으세요.')}
        </p>
      ) : (
        <RegistryList
          registry={registry}
          installed={installed}
          install={install}
          onOpenDetail={setDetail}
        />
      )}
    </div>
  )
}

/** 주소를 넣고 빼는 자리. 접혀 있다가 "배포처 관리…" 로 펼친다. */
function ManagePanel({ registry }: { registry: ReturnType<typeof useExtensionRegistry> }) {
  const [draft, setDraft] = useState('')

  const submit = () => {
    const url = draft.trim()
    if (url === '') return
    // 성공했을 때만 비운다 — 오타를 지워버리면 사용자가 처음부터 다시 쳐야 한다
    void registry.addUrl(url).then((ok) => {
      if (ok) setDraft('')
    })
  }

  return (
    <div className="dc-ext__manage">
      <div className="dc-ext__bar">
        <input
          className="dc-ext__input"
          type="text"
          aria-label={t('배포처 주소')}
          placeholder="https://axgentic.skax.local/extensions/index.json"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
        <button
          type="button"
          className="dc-ext__btn"
          disabled={draft.trim() === ''}
          onClick={submit}
        >
          {t('추가')}
        </button>
      </div>

      {registry.notice !== null && <p className="dc-ext__fail">{registry.notice}</p>}

      {/* 앱이 주소 뒤에 아무것도 덧붙이지 않는다 (표준 §4.4) — 넣은 그대로 보여준다 */}
      <ul className="dc-ext__urls">
        {registry.urls.map((url) => (
          <li key={url} className="dc-ext__url">
            <span className="dc-ext__urltext">{url}</span>
            <button
              type="button"
              className="dc-ext__btn"
              onClick={() => registry.removeUrl(url)}
              aria-label={`${t('삭제')} ${url}`}
            >
              {t('삭제')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RegistryList({
  registry,
  installed,
  install,
  onOpenDetail,
}: {
  registry: ReturnType<typeof useExtensionRegistry>
  installed: ExtensionEntryPayload[]
  install: ReturnType<typeof useRegistryInstall>
  onOpenDetail: (row: RegistryRow) => void
}) {
  const empty = registry.rows.length === 0 && registry.failures.length === 0

  if (registry.loading && empty) return <p className="dc-ext__empty">{t('불러오는 중…')}</p>

  return (
    <>
      {/* 못 읽은 배포처를 먼저 알린다 — 목록이 비어 보이는 이유가 여기 있다 */}
      {registry.failures.length > 0 && (
        <ul className="dc-ext__list">
          {registry.failures.map((failure) => (
            <li key={failure.url} className="dc-ext__row dc-ext__row--bad">
              <span className="dc-ext__icon" aria-hidden="true">
                !
              </span>
              <span className="dc-ext__body">
                <span className="dc-ext__name">{failure.url}</span>
                <span className="dc-ext__meta">{failure.message}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {registry.rows.length === 0 ? (
        registry.failures.length === 0 && (
          <p className="dc-ext__empty">{t('이 배포처에 올라온 확장이 없습니다.')}</p>
        )
      ) : (
        <ul className="dc-ext__list">
          {registry.rows.map((row) => (
            <Row
              key={rowKey(row)}
              row={row}
              installed={installed}
              busy={install.busy === rowKey(row)}
              onInstall={() => install.run(row)}
              onOpenDetail={() => onOpenDetail(row)}
            />
          ))}
        </ul>
      )}
    </>
  )
}

function Row({
  row,
  installed,
  busy,
  onInstall,
  onOpenDetail,
}: {
  row: RegistryRow
  installed: ExtensionEntryPayload[]
  busy: boolean
  onInstall: () => void
  onOpenDetail: () => void
}) {
  const { entry } = row
  const state = registryRowState(entry, installed)

  return (
    <li className="dc-ext__row">
      <span className="dc-ext__icon" aria-hidden="true">
        {entry.displayName.slice(0, 1)}
      </span>
      <span className="dc-ext__body">
        <span className="dc-ext__name">{entry.displayName}</span>
        <span className="dc-ext__meta">
          {entry.description ?? entry.name} · {entry.latest} · {row.registryName}
        </span>
      </span>
      {/* 설명을 안 내놓는 배포처에도 버튼은 늘 둔다 — 없어지면 설명이 있는지 없는지
          눌러보기 전엔 알 수 없다 (설치됨 탭과 같은 판단) */}
      <button type="button" className="dc-ext__btn" onClick={onOpenDetail}>
        {t('상세')}
      </button>
      <button
        type="button"
        className="dc-ext__btn dc-ext__action"
        // 이미 최신이면 받을 것이 없다. 되돌리기(다운그레이드)는 배포처가 latest 를 옮기면 열린다
        disabled={state === 'installed' || busy}
        onClick={onInstall}
      >
        {busy ? t('받는 중…') : t(STATE_LABEL[state])}
      </button>
    </li>
  )
}
