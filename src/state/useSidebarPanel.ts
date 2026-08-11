import { useCallback, useState } from 'react'
import type { SidebarPanel } from '../components/SidebarPanelSelect'

// 사이드바가 무엇을 보고 있는지를 **프로젝트마다 따로** 쥔다.
//
// 하나로 두면 프로젝트를 옮겨도 앞 프로젝트에서 고른 것이 그대로 남는다. 패널마다 성격이
// 달라 이게 실제로 어긋난다 — A 에서 「소스 관리」를 보다 B 로 가면 B 의 변경 목록이 뜨고,
// 확장 패널이면 결과가 비어 있는 표가 뜬다. 어느 쪽도 사용자가 요청한 화면이 아니다.
//
// **비우는 것이 아니라 기억한다.** `useScmView` 는 프로젝트가 바뀌면 통째로 비우는데,
// 저쪽은 탭 **안**의 선택(고른 파일·커밋)이라 남으면 앞 저장소 것이 새 저장소 화면에 섞인다.
// 여기는 "무엇을 볼지" 라 프로젝트마다 답이 따로 있고, 돌아왔을 때 보던 것이 그대로인
// 편이 맞다 (IntelliJ 의 도구창 선택이 프로젝트 창마다 따로인 것과 같은 결).
//
// 앱을 껐다 켜면 기본값으로 돌아온다. 디스크에 남기지 않는다 — 지금 요청은 "프로젝트마다"
// 이지 "재시작 뒤에도" 가 아니고, 남기려면 어느 저장소에 둘지부터 정해야 한다.

/** 아무것도 고른 적 없는 프로젝트가 보는 것. */
const DEFAULT_PANEL: SidebarPanel = 'files'

export interface SidebarPanelHandle {
  panel: SidebarPanel
  select: (panel: SidebarPanel) => void
}

export function useSidebarPanel(projectId: string): SidebarPanelHandle {
  const [byProject, setByProject] = useState<Record<string, SidebarPanel>>({})

  const select = useCallback(
    (next: SidebarPanel) => {
      setByProject((previous) => ({ ...previous, [projectId]: next }))
    },
    [projectId],
  )

  // 닫은 프로젝트의 것을 지우지 않는다. 다시 열면 보던 화면으로 돌아오는 편이 맞고,
  // 항목 하나가 문자열 하나라 쌓여도 값이 없다.
  return { panel: byProject[projectId] ?? DEFAULT_PANEL, select }
}
