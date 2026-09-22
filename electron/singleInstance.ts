import { app, BrowserWindow } from 'electron'

// 앱은 **무조건 하나만** 뜬다 (davis-code-desktop `9a47584` 에서 가져왔다).
//
// 잠금이 없으면 두 번째 실행이 그대로 두 번째 앱이 된다. 공여 쪽 실측(2026-09-15 Windows 설치본 사용자
// 보고)은 설치 중 창이 "응답 없음" 일 때 아이콘을 다시 누르면 앱이 하나 더 뜬 것이었다.
//
// 여기서는 그보다 나쁘다. 기동하자마자 `serverPids.reap()`(`main.ts`)이 `opencode-servers.json` 에
// 적힌 서버를 거두는데, 두 번째 앱에게는 **첫 번째 앱이 지금 쓰고 있는 서버**가 "지난 실행이 남긴 것" 으로
// 보인다 — PID 가 살아 있고 명령줄도 우리 모양이라 두 겹 대조(`opencode/pidStore.ts`)를 그대로 통과한다.
// 첫 번째 창의 대화가 서버째 끊긴다. 게다가 두 앱이 같은 projects·settings 파일을 번갈아 덮어쓴다.
//
// 잠금은 Electron 이 userData 폴더 단위로 잡는다 — `--user-data-dir` 로 다른 폴더를 주는 촬영·검증 실행은 막지 않는다.

/**
 * 첫 번째 인스턴스면 true. 두 번째면 곧바로 끝낸다(false) — 호출자는 아무것도 띄우지 않고 돌아가야 한다.
 * 창을 만들기 전, 모듈 최상위에서 부른다.
 */
export function claimSingleInstance(): boolean {
  if (!app.requestSingleInstanceLock()) {
    // quit() 은 비동기라 그 사이 whenReady 가 창을 띄울 수 있다 — 아무것도 시작하지 않은 채 바로 끝낸다
    app.exit(0)
    return false
  }
  // 두 번째 실행은 먼저 뜬 창을 앞으로 가져온다 — 사용자는 아이콘을 눌러 "앱을 보려고" 한 것이다
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  return true
}
