import { useEffect } from 'react'

// 데스크톱 MCP 서버의 `open_file` 도구가 연 파일을 본문 탭으로 띄운다 (`electron/mcp/`).
//
// **지금 보고 있는 프로젝트 것만 받는다.** 파일 탭은 프로젝트를 옮기면 비워지므로
// (`useOpenFiles`), 뒤에 있는 프로젝트에 열어 봐야 사용자가 그리로 갈 때 사라진다.
// main 이 이미 같은 판정을 하고 모델에게 "열지 못했다" 고 답하지만
// (`electron/mcp/tools.ts`), 겉봉을 벗기는 쪽에서도 확인한다 — 판정 사이에 사용자가
// 탭을 옮겼을 수 있고, 그때 남의 프로젝트 경로가 이 화면에 열리면 안 된다.
//
// ⚠️ `useMcpState` 와 이름은 닮았지만 다른 것이다. 저쪽은 앱이 MCP **클라이언트**로서
// 다루는 개인 자격 설정이고, 이쪽은 앱이 MCP **서버** 노릇을 하는 쪽이다.

export function useDesktopMcpOpen(
  activeProjectId: string | null,
  open: (path: string, revealLine?: number) => void,
): void {
  useEffect(
    () =>
      window.davis.onDesktopMcpOpenFile((payload, projectId) => {
        if (projectId !== activeProjectId) return
        open(payload.path, payload.line)
      }),
    [activeProjectId, open],
  )
}
