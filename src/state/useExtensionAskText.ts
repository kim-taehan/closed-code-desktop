import { useCallback, useEffect, useState } from 'react'
import type { ExtensionAskTextPayload } from '../../shared/ipc/channels'

// 확장의 물음을 받아 두고 답을 되돌린다 (`code.ui.askText`).
//
// **줄을 세운다.** 창은 하나뿐인데 확장이 잇달아 물을 수 있다 — 덮어쓰면 앞 물음은
// 답을 못 받고 그 확장의 `await` 가 영영 걸린다. 앞엣것을 먼저 보여주고, 답한 뒤 다음을 편다.

export interface ExtensionAskTextState {
  /** 지금 보여줄 물음. 없으면 `null` */
  current: ExtensionAskTextPayload | null
  /** 취소면 `null` */
  respond: (text: string | null) => void
}

export function useExtensionAskText(): ExtensionAskTextState {
  const [queue, setQueue] = useState<ExtensionAskTextPayload[]>([])

  useEffect(
    () => window.davis.onExtensionAskText((payload) => setQueue((previous) => [...previous, payload])),
    [],
  )

  const respond = useCallback((text: string | null) => {
    setQueue((previous) => {
      const [first, ...rest] = previous
      if (first === undefined) return previous
      // 답이 main 에 닿지 못해도 화면은 넘어간다 — 여기서 막으면 사용자가 창에 갇힌다.
      // (main 이 못 받으면 그 확장은 끊긴 채로 남지만, 그 사실을 창이 붙잡아 둘 수는 없다.)
      void window.davis.respondExtensionAskText({ requestId: first.requestId, text }).catch(() => {})
      return rest
    })
  }, [])

  return { current: queue[0] ?? null, respond }
}
