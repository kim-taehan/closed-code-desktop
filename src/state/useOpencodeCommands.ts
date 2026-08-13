import { useEffect, useState } from 'react'
import type { CommandSummaryPayload } from '../../shared/ipc/channels'

// opencode 가 아는 `/` 항목 — 명령·MCP 프롬프트·스킬이 한 배열로 온다.
//
// **`/` 팝업과 `+ → 스킬` 이 같은 것을 봐야 한다.** 두 화면이 각자 다른 목록을 부르면
// 한쪽에만 있는 항목이 생기고, 그건 사용자에겐 "있다가 없다" 로 보인다. 그래서 부르는
// 자리를 이 훅 하나로 모은다 — 스킬만 필요한 화면은 `source` 로 거른다.
//
// 목록은 **프로젝트마다 다르다** (main 이 활성 프로젝트 경로를 실어 보낸다). 프로젝트가
// 바뀌면 다시 받아야 해서 `reloadKey` 를 받는다.

export interface OpencodeCommandsState {
  commands: CommandSummaryPayload[]
  loading: boolean
  /** 목록을 못 받은 사유. 받았으면 없다. */
  error?: string
}

export function useOpencodeCommands(reloadKey?: string | null): OpencodeCommandsState {
  const [state, setState] = useState<OpencodeCommandsState>({ commands: [], loading: true })

  useEffect(() => {
    let alive = true
    setState({ commands: [], loading: true })
    void window.davis.listCommands().then((result) => {
      // 늦게 온 응답이 새 프로젝트의 목록을 덮지 않게 한다
      if (!alive) return
      setState({
        commands: result.commands,
        loading: false,
        ...(result.error ? { error: result.error } : {}),
      })
    })
    return () => {
      alive = false
    }
  }, [reloadKey])

  return state
}
