import { useEffect, useState } from 'react'
import type { OpencodeConfigFilePayload, OpencodeConfigPayload } from '../../shared/ipc/channels'
import { t } from '../i18n/messages'
import '../styles/opencodeConfig.css'

// opencode 자신의 설정 — **이 앱의 설정이 아니다.**
//
// 모델·프로바이더·MCP 는 opencode 서버가 자기 파일에서 읽는다. 앱은 붙을 뿐이라 원래
// 안 건드렸는데, MCP 를 붙이려면 결국 그 파일을 봐야 해서 화면에 꺼냈다.
//
// **탭은 전역·프로젝트 둘이고 고치는 것은 프로젝트뿐이다.** 프로젝트가 전역 위에 얹히므로
// 프로젝트를 먼저 보여 준다. 전역은 보기만 한다 — 여러 프로젝트에 한꺼번에 걸리는 자리라
// 이 창에서 고치면 어디에 영향이 가는지 알기 어렵다 (사용자 결정 2026-08-13).
//
// **파일 원문과 "지금 먹는 설정" 을 함께 보여 준다.** 둘이 갈리는 것이 실제 함정이다:
// 서버는 디렉토리를 처음 만질 때 설정을 한 번 읽고 그 뒤로는 들고 있어서, 고쳐도
// 다시 읽히기 전에는 안 먹는다. 그 "다시 읽기" 가 아래 버튼이다.

const SAVED = '저장했습니다. 아직 서버는 옛 설정을 들고 있습니다 — 아래 "설정 다시 읽기" 를 누르세요.'
const RELOADED = '다시 읽었습니다. 이 프로젝트가 새 설정으로 다시 붙었습니다.'

export function OpencodeConfigSection() {
  const [state, setState] = useState<OpencodeConfigPayload | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null)
  const [scope, setScope] = useState<'global' | 'project'>('project')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void load()
  }, [])

  async function load(): Promise<void> {
    const result = await window.davis.readOpencodeConfig()
    setState(result)
    setDrafts(Object.fromEntries(result.files.map((file) => [file.path, file.content ?? ''])))
  }

  async function save(file: OpencodeConfigFilePayload): Promise<void> {
    const result = await window.davis.writeOpencodeConfig({
      path: file.path,
      content: drafts[file.path] ?? '',
    })
    setNotice(result.ok ? { text: t(SAVED) } : { text: result.error ?? t('저장하지 못했습니다'), bad: true })
  }

  /** instance 를 버려 설정을 다시 읽힌다. 서버 프로세스는 사용자 것이라 우리가 못 끈다. */
  async function reload(): Promise<void> {
    setBusy(true)
    const result = await window.davis.reloadOpencodeConfig()
    setNotice(result.ok ? { text: t(RELOADED) } : { text: result.error ?? t('다시 읽지 못했습니다'), bad: true })
    if (result.ok) await load()
    setBusy(false)
  }

  if (state === null) return <div className="dc-palette__empty">{t('불러오는 중…')}</div>

  // 열린 프로젝트가 없으면 프로젝트 파일 자체가 없다 — 그때는 전역으로 떨어진다
  const current = state.files.find((file) => file.scope === scope) ?? state.files[0]
  const editable = current?.scope === 'project'

  return (
    <div className="dc-ocfg">
      <div className="dc-ocfg__tabs" role="tablist">
        {[...state.files].reverse().map((file) => (
          <button
            key={file.scope}
            type="button"
            role="tab"
            aria-selected={file.scope === current?.scope}
            className={`dc-ocfg__tab${file.scope === current?.scope ? ' dc-ocfg__tab--on' : ''}`}
            onClick={() => {
              setScope(file.scope)
              setNotice(null)
            }}
          >
            {t(file.scope === 'global' ? '전역' : '프로젝트')}
          </button>
        ))}
      </div>

      {current && (
        <div className="dc-ocfg__file">
          <div className="dc-ocfg__head">
            <code className="dc-ocfg__path">{current.path}</code>
            {current.content === null && !current.error && (
              <span className="dc-ocfg__tag">
                {t(editable ? '아직 없음 — 저장하면 만들어집니다' : '아직 없음')}
              </span>
            )}
          </div>

          {current.error ? (
            <div className="dc-palette__note dc-palette__note--warn">{current.error}</div>
          ) : (
            <>
              <textarea
                className="dc-ocfg__editor"
                spellCheck={false}
                // 설정 창이 560px 이라 이보다 크면 저장 버튼이 접힌다.
                // 더 넓게 보려면 끌어서 늘린다 (`resize: vertical`).
                rows={8}
                readOnly={!editable}
                value={drafts[current.path] ?? ''}
                onChange={(event) =>
                  setDrafts((draft) => ({ ...draft, [current.path]: event.target.value }))
                }
              />
              <div className="dc-ocfg__actions">
                {editable ? (
                  <>
                    <button type="button" className="dc-ocfg__save" onClick={() => void save(current)}>
                      {t('저장')}
                    </button>
                    <span className="dc-ocfg__hint">
                      {t('JSON 이 깨져 있으면 저장하지 않습니다. 덮어쓰기 전 .bak 을 남깁니다.')}
                    </span>
                  </>
                ) : (
                  <span className="dc-ocfg__hint">
                    {t('전역 설정은 여기서 보기만 합니다 — 여러 프로젝트에 한꺼번에 걸립니다.')}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {notice && (
        <div
          className={`dc-palette__note${notice.bad ? ' dc-palette__note--warn' : ''}`}
          role="status"
        >
          {notice.text}
        </div>
      )}

      <Effective state={state} busy={busy} onReload={() => void reload()} />
    </div>
  )
}

/**
 * 지금 서버가 실제로 쓰는 값.
 *
 * MCP 는 설정 파일이 아니라 `GET /mcp` 에서 온다 — **파일에 없는데 붙어 있는 것**이 있기
 * 때문이다(이 앱이 런타임으로 넣는 `closed-code-desktop`). 파일만 보면 그게 안 보인다.
 */
function Effective({
  state,
  busy,
  onReload,
}: {
  state: OpencodeConfigPayload
  busy: boolean
  onReload: () => void
}) {
  const effective = (state.effective ?? {}) as { model?: unknown }
  const mcp = state.mcp ?? {}
  const names = Object.keys(mcp)

  return (
    <div className="dc-ocfg__effective">
      <div className="dc-ocfg__head">
        <span className="dc-ocfg__scope">{t('지금 먹는 설정')}</span>
        <span className="dc-ocfg__hint">{t('서버가 합친 것')}</span>
        <button type="button" className="dc-ocfg__save" onClick={onReload} disabled={busy}>
          {t(busy ? '다시 읽는 중…' : '설정 다시 읽기')}
        </button>
      </div>

      {state.effectiveError ? (
        <div className="dc-palette__note dc-palette__note--warn">{state.effectiveError}</div>
      ) : (
        <dl className="dc-ocfg__list">
          <dt>{t('모델')}</dt>
          <dd>{typeof effective.model === 'string' ? effective.model : t('(설정 없음)')}</dd>
          <dt>MCP</dt>
          <dd>
            {names.length === 0
              ? t('(붙은 것 없음)')
              : names.map((name) => (
                  <span key={name} className="dc-ocfg__mcp">
                    {name} · {mcp[name]?.status ?? t('알 수 없음')}
                  </span>
                ))}
          </dd>
        </dl>
      )}

      <details className="dc-ocfg__raw">
        <summary>{t('원문 보기')}</summary>
        <pre>{JSON.stringify(state.effective ?? {}, null, 2)}</pre>
      </details>
    </div>
  )
}
