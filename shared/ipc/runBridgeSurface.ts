import type { PtyRunPayload, PtyRunResult } from './ptyPayloads'
import type { ProjectHandler } from './desktopBridge'

// 사이드바 「실행」 패널이 renderer 에 내놓는 표면 (설계 2026-08-16 §1·§2).
//
// `ptyBridgeSurface.ts`·`gitHistoryBridge.ts` 와 같은 자리·같은 이유로 갈라 뒀다 —
// `desktopBridge.ts` 가 300줄 상한에 붙어 있다. **renderer 쪽 쓰임은 그대로 `window.davis.*`.**
//
// **목록을 읽는 길은 여기 없다.** AGENTS.md 는 프로젝트 파일이라 이미 있는 `readFile` 로
// 읽는다 (`shared/run/runSection.ts` 가 파싱한다) — 같은 파일을 읽는 문을 두 개 두면
// 경로 판정(`resolveInside`)이 두 벌이 된다.

export interface RunBridgeSurface {
  /**
   * ▶ — 그 이름의 칸에서 명령을 돌린다. `run_project` 도구와 **같은 함수**를 탄다.
   *
   * ⚠️ **이 약속이 풀린 뒤에 탭을 만들어야 한다** (`PTY_RUN` 머리말의 순서 함정).
   */
  runShellPane(payload: PtyRunPayload): Promise<PtyRunResult>
  /**
   * AGENTS.md 의 「실행」 절이 바뀌었다 — **다시 읽으라는 신호일 뿐** 목록이 실려 오지 않는다.
   *
   * 겉봉(ProjectScoped)이 씌워져 있다: 뒤에 있는 프로젝트에서도 적을 수 있어(`tools.ts`)
   * 화면이 자기 것만 골라야 한다.
   */
  onRunListChanged(handler: ProjectHandler<Record<string, never>>): () => void
}
