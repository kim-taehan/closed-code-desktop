import { app } from 'electron'

// 창이 다 닫혔을 때(`window-all-closed`) 거두는 것들. `main.ts` 에서 뽑아 왔다.
//
// **뽑아낸 이유는 줄 수만이 아니다.** main.ts 는 커버리지 제외 구역이라 저 안에 있는 동안은
// "무엇을 어떤 순서로 거두는가" 를 시험할 방법이 없었다. 여기 있으면 잰다.
//
// **창 수명인 것만** 다룬다. 앱 수명(확장 호스트 · MCP 서버 자체 · opencode 서버 풀)은
// `quitGuard.ts` 가 잡는 종료 경로 몫이다 — 이 둘을 섞으면 macOS 에서 창을 닫았다 되살릴 때마다
// 서버가 통째로 새로 뜬다 (`main.ts` 의 `opencodeServers` 머리말과 같은 근거).

/**
 * 창에 매여 있던 것들. 구현 클래스가 아니라 **거두는 데 필요한 모양만** 받는다 —
 * 여기서 실제 브리지 타입을 끌어오면 시험하려고 만든 이 파일이 다시 electron 배선 전체를 물고 온다.
 */
export interface WindowScoped {
  projects: { dispose(): void } | null
  logs: { dispose(): void } | null
  drawer: { dispose(): Promise<void> } | null
  git: { dispose(): void } | null
  extensionIpc: { dispose(): void } | null
  bridge: { dispose(): Promise<void> } | null
  mcp: { forgetRegistrations(): void } | null
}

/**
 * 창 수명 물건을 전부 거둔다. **동기 부분은 돌아가기 전에 끝난다** —
 * 유일하게 비동기인 `bridge.dispose()` 만 뒤에 남고, 그것이 끝난 뒤 할 일이
 * `onBridgeDisposed` 다 (호출부의 모듈 변수를 비우는 자리).
 *
 * `bridge` 참조를 여기서 끊지 않고 콜백으로 미루는 것이 요점이다. 시작하자마자 비우면
 * 정리가 도는 동안 확장 호스트의 `askViaChat` 이 살아 있는 브리지 대신 null 을 받는다.
 */
export function disposeWindowScoped(scoped: WindowScoped, onBridgeDisposed: () => void): void {
  scoped.projects?.dispose()
  scoped.logs?.dispose()
  // 창이 사라지면 드로어도 없다. 서버 쪽 pty 는 그대로 둔다 — 창을 다시 만들면 되찾는다.
  void scoped.drawer?.dispose()
  // MCP 서버는 계속 듣는다 (포트·토큰이 바뀌면 opencode 쪽 등록이 죽는다).
  // 등록 표시만 비워, 창을 되살렸을 때 다시 등록되게 한다.
  scoped.mcp?.forgetRegistrations()
  scoped.git?.dispose()
  // 창이 다시 만들어지면 register() 가 다시 불린다 — 안 풀면 두 번째 등록에서 던진다
  scoped.extensionIpc?.dispose()
  // 우리가 띄운 서버를 정리하고 나서 종료한다 (`bridge.dispose` 가 풀까지 거둔다).
  // macOS 는 여기서 앱이 안 죽는다 — 독에서 되살리면 서버도 다시 뜬다.
  void scoped.bridge?.dispose().finally(() => {
    onBridgeDisposed()
    if (process.platform !== 'darwin') app.quit()
  })
}
