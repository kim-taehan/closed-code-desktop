import { useEffect, useState } from 'react'
import type { McpServerStatus, McpState } from '../../shared/protocol/mcpConfig'

// 설정 창의 "MCP" — 개인 자격 설정.
//
// **값은 올려보내기만 한다.** 응답에는 값이 오지 않고 키 이름만 온다 —
// 원본 보관처가 이쪽이고 노출 면적을 줄이려는 것이다 (runtime 규칙).
// 그래서 저장된 값을 되불러와 칸에 채우지 않는다. 채워져 있다는 사실만 보여준다.

export interface McpSectionProps {
  state: McpState
}

export function McpSection({ state }: McpSectionProps) {
  useEffect(() => {
    void window.davis.requestMcpStatus()
  }, [])

  if (state.servers.length === 0) {
    return (
      <section className="dc-settings__section">
        <h3 className="dc-settings__heading">MCP</h3>
        <p className="dc-settings__hint dc-settings__hint--above">
          이 프로젝트에 설정된 MCP 서버가 없습니다. 서버는 관리자 화면에서 등록합니다.
        </p>
      </section>
    )
  }

  return (
    <section className="dc-settings__section">
      <h3 className="dc-settings__heading">MCP</h3>
      <p className="dc-settings__hint dc-settings__hint--above">
        내 계정 자격을 넣습니다. 입력한 값은 이 컴퓨터에서 런타임으로만 가고 되돌아오지 않습니다.
      </p>

      {/* 정책이 꺼져 있으면 넣어도 쓰이지 않는다 — 넣기 전에 알려야 한다 */}
      {!state.policyEnabled && (
        <p className="dc-settings__warn">
          이 프로젝트는 개인 자격을 쓰지 않도록 되어 있습니다. 관리자에게 문의하세요.
        </p>
      )}

      {state.servers.map((server) => (
        <ServerCard key={server.serverName} server={server} />
      ))}
    </section>
  )
}

function ServerCard({ server }: { server: McpServerStatus }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const filled = server.credentialSchema.filter((field) => (values[field.key] ?? '') !== '')
  const canSave = filled.length > 0

  function run(action: () => Promise<void>): void {
    setBusy(true)
    void action().finally(() => {
      setBusy(false)
      setValues({})
    })
  }

  return (
    <div className="dc-mcp">
      <div className="dc-mcp__head">
        <span className="dc-mcp__name">{server.serverName}</span>
        <span className={`dc-mcp__state${server.configured ? ' dc-mcp__state--on' : ''}`}>
          {server.authMode === 'oauth'
            ? server.oauthAuthenticated
              ? '로그인됨'
              : '로그인 필요'
            : server.configured
              ? '설정됨'
              : '미설정'}
        </span>
      </div>

      {server.authMode === 'oauth' ? (
        // 원격 서버는 사용자가 입력할 키가 없다 — 로그인 흐름은 아직 만들지 않았다
        <p className="dc-settings__hint">
          이 서버는 로그인 방식입니다. 데스크탑에서는 아직 로그인할 수 없습니다.
        </p>
      ) : (
        <>
          {server.credentialKeys.length > 0 && (
            <p className="dc-settings__hint">채워진 항목: {server.credentialKeys.join(', ')}</p>
          )}

          {server.credentialSchema.map((field) => (
            <div key={field.key} className="dc-mcp__field">
              <span className="dc-settings__label">
                {field.key}
                {!field.required && <span className="dc-settings__scope">선택</span>}
              </span>
              <input
                className="dc-settings__input"
                type="password"
                value={values[field.key] ?? ''}
                placeholder={server.credentialKeys.includes(field.key) ? '채워져 있음' : ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
                aria-label={`${server.serverName} ${field.key}`}
              />
            </div>
          ))}

          <div className="dc-settings__row">
            <button
              type="button"
              className="dc-settings__apply"
              disabled={!canSave || busy}
              onClick={() =>
                run(() =>
                  window.davis.testMcpCredentials({
                    serverName: server.serverName,
                    credentials: values,
                  }),
                )
              }
            >
              연결 확인
            </button>
            <button
              type="button"
              className="dc-settings__apply dc-settings__apply--urge"
              disabled={!canSave || busy}
              onClick={() =>
                run(() =>
                  window.davis.setMcpCredentials({
                    serverName: server.serverName,
                    credentials: values,
                    enabled: true,
                  }),
                )
              }
            >
              저장
            </button>
            {server.configured && (
              <button
                type="button"
                className="dc-settings__apply"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    window.davis.setMcpCredentials({
                      serverName: server.serverName,
                      credentials: {},
                      enabled: false,
                    }),
                  )
                }
              >
                해제
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
