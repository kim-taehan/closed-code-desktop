import type { PtyClient } from './client'

// `PtyPool` 의 겉면 — 무엇을 받고 무엇을 돌려주는가. 수명과 표는 `ptyPool.ts` 가 쥔다.
//
// 떼어 낸 이유는 `shared/ipc/ptyBridgeSurface.ts` 와 같다: 계약에 붙은 주석이 구현보다 길고,
// 한 파일에 두면 300줄 상한에 걸린다. **주석을 지워 줄이지 않는다** — 여기 적힌 것은 전부
// 실측 근거다.

export interface PtyPoolEvents {
  /**
   * 소켓 핸드셰이크가 끝났다 — **이제 써도 된다.**
   *
   * `open()` 이 돌아온 시점의 소켓은 아직 CONNECTING 이고, 그때 쓴 바이트는 아무 흔적 없이
   * 사라진다 (`PtySocket.open` 의 실측). 「맡아 둔 명령」이 이 신호를 기다린다.
   */
  onOpen(projectId: string, name: string): void
  onData(projectId: string, name: string, chunk: string): void
  onExit(projectId: string, name: string, exitCode: number | null): void
}

export interface PtyPoolOptions {
  /** 그 프로젝트의 서버에 붙는 클라이언트. 서버가 아직 없으면 거절한다 (`drawerBridge`) */
  clientFor: () => Promise<PtyClient>
  events: PtyPoolEvents
}

export interface PaneOpenResult {
  /**
   * **이 칸은 이미 돌고 있었다** — 우리가 새로 띄운 것이 아니다.
   *
   * 두 경로가 여기로 모인다: 우리 표에 이미 있었거나(같은 판에서 두 번 열었다), 서버에
   * 우리 제목의 pty 가 살아 있어 되찾았거나(앱을 껐다 켰다). 부르는 쪽에서는 **둘 다 같은
   * 뜻**이다 — 명령을 또 밀어 넣으면 개발 서버가 둘이 된다 (`run_project` 의 「겹쳐 띄우지
   * 않는다」, 설계 §3).
   *
   * 셸 칸에서는 이 값이 늘 참에 가깝고 그게 정상이다 — 되찾기가 셸 칸의 설계다
   * (`ptyPool.ts` 머리말의 표). 그래서 화면에서 칸을 펴는 쪽(`drawerBridge.open`)은
   * 이 값을 보지 않는다.
   */
  reclaimed: boolean
}
