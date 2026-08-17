import { useCallback } from 'react'
import { describeError } from '../../shared/errors/describeError'

// 확장 화면(본문 탭)이 `data-command` 로 부른 명령을 main 으로 보낸다.
//
// **왜 `useExtensionPanel.runCommand` 를 안 쓰는가:** 그것은 사이드바 안에 산다
// (`ProjectSidebar` 가 훅을 부른다). 본문 탭은 `MainView` 쪽이라 닿지 않고, 닿게 하려면
// 확장 패널 상태를 앱 꼭대기로 들어올려야 한다 — 이번 변경(`data-command`)과 무관한 이동이다.
//
// 대신 **주인 확장을 함께 싣는다.** 사이드바 경로는 명령 id 만 보내고 자식이 명령표에서
// 찾는데(`childHandlers.ts`), 그 표는 확장 전부가 함께 쓴다. 화면에서 온 명령은
// 「누구의 화면인가」가 있으니 그것을 근거로 자식이 주인을 확인한다.

export function useExtensionViewCommand(
  /** 실패를 알린다 (`useToasts.show`). 화면에 흔적이 안 남는 실패라 알려야 한다. */
  notify: (text: string, tone?: 'info' | 'error') => void,
): (extension: string, commandId: string, target?: string) => void {
  return useCallback(
    (extension, commandId, target) => {
      void window.davis
        // 대상은 **기존 `selection` 계약**으로 간다 — 화면에서 고른 것을 나르는 그 자리다
        .runExtensionCommand({ commandId, extension, ...(target !== undefined ? { selection: [target] } : {}) })
        // 거절을 다시 던지지 않는다 — 알리는 일은 여기서 끝났다
        // (`useExtensionPanel.runCommand` 와 같은 규칙).
        .catch((error: unknown) => {
          notify(`명령을 실행하지 못했습니다: ${describe(error)}`, 'error')
        })
    },
    [notify],
  )
}

/** `ipcMain.handle` 거부가 붙이는 앞머리를 뗀다 (`useExtensionPanel.ts` 의 같은 함수). */
function describe(error: unknown): string {
  const message = describeError(error)
  return message.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')
}
