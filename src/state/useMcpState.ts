import { useEffect, useState } from 'react'
import { EMPTY_MCP_STATE, type McpState } from '../../shared/protocol/mcpConfig'

// 커넥터(MCP) 연결 상태. 서버가 정본이고 화면은 받은 것만 보여준다.
//
// davis 때는 여기 실리는 것이 **개인 자격**이었고, 남의 프로젝트 목록을 보여주면 엉뚱한 곳에
// 자격을 넣게 되는 것이 프로젝트별로 가르는 이유였다. opencode 로 오며 자격은 사라졌지만
// 가르는 이유는 그대로다 — **MCP 서버 목록 자체가 프로젝트별이고**(`?directory=` 로 갈린다),
// 섞이면 「다시 연결」이 남의 프로젝트 서버를 건드린다.

export function useMcpState(activeId: string | null): McpState {
  const [byProject, setByProject] = useState<Record<string, McpState>>({})

  useEffect(
    () =>
      window.davis.onMcpState((state, projectId) =>
        setByProject((current) => ({ ...current, [projectId]: state })),
      ),
    [],
  )

  return (activeId !== null ? byProject[activeId] : undefined) ?? EMPTY_MCP_STATE
}
