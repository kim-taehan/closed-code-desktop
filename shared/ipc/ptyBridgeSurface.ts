import type {
  PtyClosePayload,
  PtyDataPayload,
  PtyDetachPayload,
  PtyExitPayload,
  PtyInputPayload,
  PtyOpenPayload,
  PtyOpenResult,
  PtyResizePayload,
} from './ptyPayloads'
import type { ProjectHandler } from './desktopBridge'

// 셸 드로어가 renderer 에 내놓는 표면. `desktopBridge.ts` 가 상속해 합친다 —
// **renderer 쪽 쓰임은 그대로 `window.davis.*`** 다.
//
// 갈라 둔 이유는 `gitHistoryBridge.ts`·`preloadPty.ts` 와 같다: `desktopBridge.ts` 가
// 300줄 상한에 붙어 있고, 탭(=칸이 여럿)이 들어오며 넘겼다. **자리를 고르는 데 근거가
// 하나 더 있다** — main 쪽 배선도 이미 `preloadPty.ts` 로 갈라져 있어 짝이 맞는다.

export interface PtyBridgeSurface {
  /**
   * 하단 셸 드로어 (⌘↓/⌘↑). 셸은 **opencode 서버가 굴린다** (`/api/pty`).
   *
   * `runShell`(`!명령` 한 번 실행 → 대화에 결과를 남긴다)과 성격이 다르다 —
   * 이쪽은 살아 있는 셸에 붙어 바이트를 주고받는다.
   * 어느 프로젝트인지는 **main 이 활성 프로젝트로 푼다** (렌더러가 보내지 않는다).
   *
   * **`name` 은 렌더러가 정한다** — 탭 하나가 pty 하나이고, 그 목록을 쥔 것이 화면이다
   * (`src/state/drawerTabs.ts`). 프로젝트와 달리 main 이 풀 수 있는 값이 아니다.
   */
  openShellDrawer(payload: PtyOpenPayload): Promise<PtyOpenResult>
  /** 누른 키를 그대로. **응답을 기다리지 않는다** — 왕복을 기다리면 타이핑이 느려진다 */
  sendShellInput(payload: PtyInputPayload): void
  resizeShell(payload: PtyResizePayload): Promise<void>
  /**
   * 그 칸에서 손을 뗀다. **셸은 죽이지 않는다** — 다시 펴면 스크롤백째 돌아온다.
   * ⌘↑ 로 접을 때가 아니라 **프로젝트를 옮길 때** 부른다 (`PtyDetachPayload` 머리말).
   */
  detachShellDrawer(payload: PtyDetachPayload): void
  /** 탭의 ✕ — **프로세스도 멈춘다.** 위 `detach` 와 갈리는 지점이다 (`PtyClosePayload`) */
  closeShellPane(payload: PtyClosePayload): Promise<void>
  onShellData(handler: ProjectHandler<PtyDataPayload>): () => void
  onShellExit(handler: ProjectHandler<PtyExitPayload>): () => void
}
