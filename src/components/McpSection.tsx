import { useEffect, useState } from 'react'
import type { McpState } from '../../shared/protocol/mcpConfig'
import { McpServerDetail } from './McpServerDetail'
import { McpServerList } from './McpServerList'

// 커넥터(MCP) 다이얼로그의 본문 — **연결 상태**를 보여준다.
//
// 여기는 davis 시절 **개인 자격 입력 칸**이었다. 값은 올려보내기만 하고 응답에는 키 이름만
// 오는 계약이라, 저장된 값을 되불러와 칸에 채우지 않고 채워져 있다는 사실만 보여줬다.
// **opencode 에는 그 개념이 없다** — 서버 목록도 자격도 사용자의 `opencode.json` 이 정하고
// 앱이 밀어 넣을 자리가 없다. 그래서 입력 칸을 걷어내고 상태 카드로 바꿨다
// (payload 가 왜 통째로 바뀌었는지는 `shared/protocol/mcpConfig.ts` 머리말).
//
// **지금은 그 카드를 한 줄로 쌓지 않고 왼쪽(리스트)·오른쪽(상세)으로 가른다.** 카드를 쌓던
// 시절에는 서버마다 도구 칩 수십 개가 딸려 세로로 한없이 길어졌고, 다이얼로그의 왼쪽 열이
// 180px 이라 **칩이 잘린 채 오른쪽은 통째로 비어 있었다.** 나눈 자리는 두 파일이다:
//   `McpServerList`   — 고르는 데 필요한 것만 (이름·상태·갈래)
//   `McpServerDetail` — 고른 하나의 전부 (**도구 칩은 여기에만 있다**)

export interface McpSectionProps {
  state: McpState
}

export function McpSection({ state }: McpSectionProps) {
  /** 사용자가 고른 서버. 안 골랐으면 `null` 이고 그때는 첫 서버가 펼쳐진다. */
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    void window.davis.requestMcpStatus()
  }, [])

  const first = state.servers[0]
  if (first === undefined) {
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

  // 목록이 다시 오면서 고른 서버가 사라졌을 수 있다 (`opencode.json` 을 고치면 온다).
  // 되돌리는 효과를 걸지 않고 여기서 순수하게 유도한다 — 그러면 어긋날 자리가 없다.
  const selected = state.servers.find((server) => server.serverName === picked) ?? first

  return (
    <div className="dc-mcp-split">
      <div className="dc-mcp-list">
        <McpServerList servers={state.servers} selected={selected.serverName} onPick={setPicked} />
        <McpFooter />
      </div>
      {/* 서버를 갈아타면 상세를 새로 짓는다 — `key` 가 없으면 앞 서버에서 펼쳐 둔 도구 설명이
          이름만 바뀐 채 남는다 (`McpServerDetail` 의 `picked` 는 그 안의 상태다). */}
      <McpServerDetail key={selected.serverName} server={selected} />
    </div>
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
