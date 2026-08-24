import type { McpServerStatus } from '../../shared/protocol/mcpConfig'
import { kindOf, LABELS, TONES } from './mcpStatus'

// 커넥터 다이얼로그의 **왼쪽 — 서버 리스트.**
//
// 여기에 실리는 것은 **고르는 데 필요한 것만**이다: 이름 · 상태 점 · 갈래 · 연결 배지.
// 도구 칩·주소·오류 원문은 오른쪽 상세로 갔다 (`McpServerDetail`). 예전에는 이 셋이
// 전부 한 열에 쌓여 있었고, 다이얼로그의 왼쪽 열이 180px 이라 **도구 칩이 잘렸다** —
// 오른쪽은 통째로 비어 있는 채로. 자리를 나눈 것이 이 파일이 생긴 이유다.

export interface McpServerListProps {
  servers: McpServerStatus[]
  /** 지금 오른쪽에 펼쳐진 서버의 이름. */
  selected: string
  onPick: (serverName: string) => void
}

export function McpServerList({ servers, selected, onPick }: McpServerListProps) {
  return (
    // 이름을 붙인 묶음이다 — 갈래·상태 같은 낱말이 오른쪽 상세에도 똑같이 나오므로,
    // 어느 쪽을 읽고 있는지가 화면 낭독에도 시험에도 필요하다 (`McpSection.test.tsx`).
    <div className="dc-mcp-list__items" role="group" aria-label="MCP 서버 목록">
      {servers.map((server) => {
        const tone = TONES[server.status]
        const kind = kindOf(server)
        const on = server.serverName === selected
        return (
          <button
            key={server.serverName}
            type="button"
            aria-current={on}
            className={`dc-mcp-list__item${on ? ' dc-mcp-list__item--on' : ''}`}
            onClick={() => onPick(server.serverName)}
          >
            <span className="dc-mcp-list__top">
              <span className={`dc-mcp__dot dc-mcp__dot--${tone}`} />
              <span className="dc-mcp__name">{server.serverName}</span>
            </span>
            <span className="dc-mcp-list__foot">
              {kind !== '' && <span className="dc-mcp__kind">{kind}</span>}
              <span className={`dc-mcp__state dc-mcp__state--${tone}`}>{LABELS[server.status]}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
