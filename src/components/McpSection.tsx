import { useEffect, useState } from 'react'
import type { McpConnectionStatus, McpServerStatus, McpState } from '../../shared/protocol/mcpConfig'

// 커넥터(MCP) 다이얼로그의 본문 — **연결 상태**를 보여준다.
//
// 여기는 davis 시절 **개인 자격 입력 칸**이었다. 값은 올려보내기만 하고 응답에는 키 이름만
// 오는 계약이라, 저장된 값을 되불러와 칸에 채우지 않고 채워져 있다는 사실만 보여줬다.
// **opencode 에는 그 개념이 없다** — 서버 목록도 자격도 사용자의 `opencode.json` 이 정하고
// 앱이 밀어 넣을 자리가 없다. 그래서 입력 칸을 걷어내고 상태 카드로 바꿨다
// (payload 가 왜 통째로 바뀌었는지는 `shared/protocol/mcpConfig.ts` 머리말).
//
// 「다시 연결」·「켜기」는 **같은 호출 하나**다 — opencode 의 `POST /mcp/:name/connect` 가
// 꺼진 서버도 켠다 (실측). 그 호출은 davis 봉투 `mcp_config_set` 을 타고 나가고, 어댑터가
// 번역한다 — 그래서 IPC 이름이 아직 `setMcpCredentials` 다. **자격은 안 실린다.**

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
        {/* 문구가 davis 때는 "관리자 화면에서 등록합니다" 였다. opencode 세계에는 그런 화면이
            없어 거짓이 됐다 — 등록처를 정직하게 가리킨다. */}
        <p className="dc-settings__hint dc-settings__hint--above">
          {state.message === ''
            ? '이 프로젝트에 설정된 MCP 서버가 없습니다.'
            : `서버 목록을 받지 못했습니다 — ${state.message}`}
        </p>
        <McpFooter />
      </section>
    )
  }

  return (
    <section className="dc-settings__section">
      {state.servers.map((server) => (
        <ServerCard key={server.serverName} server={server} />
      ))}
      <McpFooter />
    </section>
  )
}

function McpFooter() {
  return (
    <p className="dc-mcp__foot">
      서버 등록·삭제는 <code className="dc-mcp__path">~/.config/opencode/opencode.json</code> 에서 ·
      저장하면 자동 반영
    </p>
  )
}

/** 상태 셋 말고도 OAuth 갈래가 둘 더 온다 — 모르는 것을 「실패」로 칠하지 않는다. */
const LABELS: Record<McpConnectionStatus, string> = {
  connected: '연결됨',
  failed: '실패',
  disabled: '꺼짐',
  needs_auth: '로그인 필요',
  needs_client_registration: '등록 필요',
  unknown: '알 수 없음',
}

const TONES: Record<McpConnectionStatus, string> = {
  connected: 'ok',
  failed: 'err',
  disabled: 'off',
  needs_auth: 'warn',
  needs_client_registration: 'warn',
  unknown: 'off',
}

/** `error` 를 싣는 갈래 둘 (`MCPStatusFailed`·`MCPStatusNeedsClientRegistration` 만 필수다). */
function failed(status: McpConnectionStatus): boolean {
  return status === 'failed' || status === 'needs_client_registration'
}

function ServerCard({ server }: { server: McpServerStatus }) {
  const [busy, setBusy] = useState(false)
  const tone = TONES[server.status]
  // 도구를 아는 것은 우리가 띄운 서버뿐이다 (`electron/opencode/mcpConfig.ts` — opencode 는
  // 남의 서버 도구를 안 준다). 그래서 이 목록이 곧 "이 앱이 띄웠다" 는 표식이다.
  const ours = server.tools.length > 0
  const kind = ours ? 'local · 이 앱이 띄움' : server.transport === 'unknown' ? '' : server.transport

  function connect(enabled: boolean): void {
    setBusy(true)
    void window.davis
      .setMcpCredentials({ serverName: server.serverName, credentials: {}, enabled })
      .finally(() => setBusy(false))
  }

  return (
    <div className="dc-mcp">
      <div className="dc-mcp__head">
        <span className={`dc-mcp__dot dc-mcp__dot--${tone}`} />
        <span className="dc-mcp__name">{server.serverName}</span>
        {/* 설정에 없는 남의 런타임 등록 서버는 갈래를 알 길이 없다 — 빈 칸을 그리느니 뺀다 */}
        {kind !== '' && <span className="dc-mcp__kind">{kind}</span>}
        <span className={`dc-mcp__state dc-mcp__state--${tone}`}>{LABELS[server.status]}</span>
      </div>

      {server.url !== undefined && <p className="dc-mcp__url">{server.url}</p>}

      {/* **오류 원문은 한 줄이 아닐 수 있다.** OAuth 감지가 걸린 원격에서 개행 섞인 490자
          JSON 덩어리(zod 이슈 배열)가 그대로 왔다 — **contract-qa2 실측**이고 나는 재현하지
          못했다(OAuth 를 요구하는 실물 서버를 못 만들었다). 그래서 pre-wrap 에 높이를 재운다.

          거꾸로 `error` 가 **빈 문자열**인 `failed` 도 contract-qa2 가 쟀다. 그 경우는 실측과
          별개로 **구조적으로도 도달한다** — `parseMcpState` 가 `error !== ''` 로 빈 값을
          떨구므로, 서버가 빈 문자열을 주면 여기에는 `error` 자체가 없이 온다.
          그때 아무것도 안 그리면 빨간 pill 만 남아 사용자가 이유를 물을 곳이 없다. */}
      {failed(server.status) && (
        <p className="dc-mcp__err">{server.error ?? '서버가 실패 사유를 알려주지 않았습니다.'}</p>
      )}

      {server.tools.length > 0 && (
        <div className="dc-mcp__tools">
          {server.tools.map((tool) => (
            <span key={tool} className="dc-mcp__tool">
              {tool}
            </span>
          ))}
        </div>
      )}

      {/* 꺼진 서버만 문구가 다르다. 부르는 곳은 하나다 — opencode 가 둘을 안 가른다.
          **「켜기」는 설정 파일에 안 남는다** — connect 뒤에도 `opencode.json` 의 `enabled` 는
          `false` 그대로다 (contract-qa 실측). 이 실행에서만 켜지는 것이라 title 로 밝힌다.
          "영구히 켜기" 로 읽히면 거짓말이 된다. */}
      {(failed(server.status) || server.status === 'disabled') && (
        <button
          type="button"
          className={`dc-settings__apply${server.status === 'disabled' ? '' : ' dc-settings__apply--urge'}`}
          disabled={busy}
          title={
            server.status === 'disabled'
              ? '이 실행에서만 켭니다 — 설정 파일은 그대로입니다'
              : '다시 붙어 봅니다'
          }
          onClick={() => connect(true)}
        >
          {server.status === 'disabled' ? '켜기' : '다시 연결'}
        </button>
      )}
    </div>
  )
}
