import { app } from 'electron'

// 앱 종료를 한 번 붙잡아 **우리가 띄운 opencode 서버를 회수할 시간을 번다.**
//
// 예전에는 `before-quit` 에서 정리를 `void` 로 흘렸고, 그래도 됐다 — 정리할 것이 소켓과
// 우리 포트뿐이라 프로세스가 죽으면 전부 함께 사라졌다. 지금은 **자식 프로세스**
// (`opencode serve`, 프로젝트마다 하나)가 걸려 있고, GUI 로 띄운 앱에는 부모를 죽일 때
// 자식까지 데려가 줄 터미널·프로세스 그룹이 없다. 흘려보내면 서버가 그대로 남는다.
//
// `app.quit()` 이 아니라 `app.exit()` 로 끝내는 이유: quit 은 이 핸들러로 되돌아온다.
// `quitting` 빗장은 그 되돌이(그리고 사용자가 ⌘Q 를 두 번 누르는 경우)를 막는다.
//
// ⚠️ **정리가 끝나지 않으면 앱이 안 죽는다.** 회수 쪽(`serverPool`)은 SIGTERM 뒤 5초에
// SIGKILL 로 끝을 보므로 무한정 매달리지는 않는다 (`serverProcess.ts` 의 `KILL_GRACE_MS`).

export function installQuitGuard(finish: () => Promise<void>): void {
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void finish().finally(() => app.exit(0))
  })
}
