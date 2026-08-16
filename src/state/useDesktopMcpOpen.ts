import { useEffect } from 'react'

// 데스크톱 MCP 서버의 도구가 시킨 화면 조작 (`electron/mcp/`) — 파일 열기와 셸 칸 펴기.
//
// **지금 보고 있는 프로젝트 것만 받는다.** 파일 탭은 프로젝트를 옮기면 비워지므로
// (`useOpenFiles`), 뒤에 있는 프로젝트에 열어 봐야 사용자가 그리로 갈 때 사라진다.
// 셸 칸은 앱 하나를 나눠 쓰므로(`useShellDrawer`) 더 나쁘다 — 뒤에 있는 프로젝트가
// 시킨 것이 **지금 보고 있는 프로젝트의 칸**을 펴 버린다.
// main 이 이미 같은 판정을 하고 모델에게 "열지 못했다" 고 답하지만
// (`electron/mcp/tools.ts`), 겉봉을 벗기는 쪽에서도 확인한다 — 판정 사이에 사용자가
// 탭을 옮겼을 수 있고, 그때 남의 프로젝트 것이 이 화면에 나타나면 안 된다.
//
// ⚠️ `useMcpState` 와 이름은 닮았지만 다른 것이다. 저쪽은 앱이 MCP **클라이언트**로서
// 다루는 개인 자격 설정이고, 이쪽은 앱이 MCP **서버** 노릇을 하는 쪽이다.

export function useDesktopMcpOpen(
  activeProjectId: string | null,
  open: (path: string, revealLine?: number) => void,
  openTerminal: () => void,
  showPane: (name: string) => void,
): void {
  useEffect(
    () =>
      window.davis.onDesktopMcpOpenFile((payload, projectId) => {
        if (projectId !== activeProjectId) return
        open(payload.path, payload.line)
      }),
    [activeProjectId, open],
  )

  // 칸을 펴기만 한다. **채울 글자는 이 프레임에 실려 와도 쓰지 않는다** — pty 에 넣는 일은
  // main 이 한다 (`electron/pty/drawerBridge.ts` 의 `fill`). 소켓이 언제 열리는지는 main 만
  // 알고, 열리기 전에 쓴 바이트는 흔적 없이 사라진다.
  useEffect(
    () =>
      window.davis.onDesktopMcpOpenTerminal((_payload, projectId) => {
        if (projectId !== activeProjectId) return
        openTerminal()
      }),
    [activeProjectId, openTerminal],
  )

  // `run_project` — **탭만 만든다.** pty 도 명령도 main 이 이 프레임보다 먼저 끝냈다
  // (`electron/mcp/appWiring.ts`). 그래도 탭이 반드시 떠야 하는 이유는 **멈추는 문이
  // 거기뿐**이기 때문이다: 정지·재시작은 사람만 하고(설계 §3), 사람이 쓰는 문이 탭의 ✕ 다.
  // 뒤에 있는 프로젝트 것을 걸러내는 이유는 위 둘과 같다.
  useEffect(
    () =>
      window.davis.onDesktopMcpRunProject((payload, projectId) => {
        if (projectId !== activeProjectId) return
        showPane(payload.name)
      }),
    [activeProjectId, showPane],
  )
}
