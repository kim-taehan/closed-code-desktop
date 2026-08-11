import { useEffect, useState } from 'react'
import { EMPTY_MCP_STATE, type McpState } from '../../shared/protocol/mcpConfig'

// 개인 MCP 자격 상태. runtime 이 정본이고 화면은 받은 것만 보여준다.
//
// 프로젝트마다 다르므로 활성 프로젝트 것만 남긴다 —
// 남의 프로젝트 서버 목록을 보여주면 엉뚱한 곳에 자격을 넣는다.

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
