import { useEffect } from 'react'

// 확장이 열라고 한 파일(`code.workspace.openFile`)을 본문 탭으로 연다.
//
// `useExtensionViewOpen`(웹뷰 탭)과 같은 물음에 같은 답을 한다 — **지금 보고 있는 프로젝트의 것만**.
// 갈라 둔 것은 행선지가 달라서다: 저쪽은 확장이 그린 화면이고 이쪽은 프로젝트의 파일이라,
// 여는 길도 탭 식별자도 다르다 (`openWebview` vs `open`).
//
// **겉봉을 여기서 한 번 더 본다 (두 겹).** main 도 보내기 전에 화면의 프로젝트인지 봤지만
// (`electron/ipc/extensionUiBridge.ts`), IPC 한 번 사이에 사용자가 프로젝트를 옮길 수 있다.
// 그때는 파일이 안 열리고 확장은 성공으로 안다 — 되받는 왕복은 두지 않았다 (`chat.post` 와 같은 틈).

export function useExtensionOpenFile(
  activeProjectId: string | null,
  /** `useOpenFiles.open` — 이미 열린 탭이면 그 탭으로 가고 갈 줄만 갱신한다 */
  open: (path: string, revealLine?: number) => void,
): void {
  useEffect(
    () =>
      window.davis.onExtensionOpenFile((payload, from) => {
        if (from !== activeProjectId) return
        open(payload.path, payload.line)
      }),
    [activeProjectId, open],
  )
}
