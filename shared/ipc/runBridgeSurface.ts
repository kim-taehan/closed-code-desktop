import type { PtyRunPayload, PtyRunResult } from './ptyPayloads'
import type { ProjectHandler } from './desktopBridge'
import type { RunEntry } from '../run/runList'

// 사이드바 「실행」 패널이 renderer 에 내놓는 표면 (설계 2026-08-16 §1·§2).
//
// `ptyBridgeSurface.ts`·`gitHistoryBridge.ts` 와 같은 자리·같은 이유로 갈라 뒀다 —
// `desktopBridge.ts` 가 300줄 상한에 붙어 있다. **renderer 쪽 쓰임은 그대로 `window.davis.*`.**
//
// ⚠️ 여기에는 **"목록을 읽는 길은 여기 없다 — AGENTS.md 는 프로젝트 파일이라 `readFile` 로
// 읽는다"** 고 적혀 있었다. 목록이 앱 저장소로 옮겨 가며 거짓이 됐다
// (`shared/run/runList.ts` 머리말). 이제 프로젝트 밖이라 `readFile` 이 못 닿고,
// **읽는 문이 여기 생겼다** (`readRunList`) — 경로 판정이 두 벌이 되는 걱정은 없다:
// 이 문은 경로를 받지 않고 프로젝트 신원만 받는다.

export interface RunListPayload {
  projectId: string
}

export interface RunListResultPayload {
  /**
   * 목록이 **있었나.** 없는 것과 비어 있는 것은 다른 사실이라 가른다 — 앞은 아직 안
   * 물어본 것이고, 뒤는 물어봤는데 못 찾은 것이다 (`runSourceLine`).
   */
  found: boolean
  entries: RunEntry[]
  /**
   * 매니페스트가 목록을 적을 때와 **다르다.** 화면이 "다시 확인할까요?" 를 띄운다.
   *
   * **판정은 main 이 한다** — 지문을 재는 곳이 둘이면 값이 갈린다(`runManifestDisk.ts`).
   */
  stale: boolean
}

export interface RunBridgeSurface {
  /**
   * ▶ — 그 이름의 칸에서 명령을 돌린다. `run_project` 도구와 **같은 함수**를 탄다.
   *
   * ⚠️ **이 약속이 풀린 뒤에 탭을 만들어야 한다** (`PTY_RUN` 머리말의 순서 함정).
   */
  runShellPane(payload: PtyRunPayload): Promise<PtyRunResult>
  /**
   * 그 프로젝트의 실행 목록 (`RUN_LIST_READ`).
   *
   * 목록이 프로젝트 밖(앱 저장소)에 있어 새로 낸 문이다 — 예전에는 `PROJECT_READ_FILE` 로
   * AGENTS.md 를 읽었다. 「다시 확인할까요?」 판정(`stale`)도 여기서 함께 온다: 매니페스트를
   * 읽는 곳이 둘이 되면 지문이 안 맞아 물음이 영영 안 사라진다
   * (`electron/run/runManifestDisk.ts` 머리말).
   */
  readRunList(payload: RunListPayload): Promise<RunListResultPayload>
  /**
   * 실행 목록이 바뀌었다 (`RUN_LIST_CHANGED`) — **다시 읽으라는 신호일 뿐** 목록이 실려
   * 오지 않는다. 정본은 앱 저장소이고(`electron/run/runListStore.ts`) 화면이 `readRunList`
   * 로 다시 읽는다. 실어 보내면 정본이 둘이 된다.
   *
   * 겉봉(ProjectScoped)이 씌워져 있다: 뒤에 있는 프로젝트에서도 적을 수 있어(`tools.ts`)
   * 화면이 자기 것만 골라야 한다.
   */
  onRunListChanged(handler: ProjectHandler<Record<string, never>>): () => void
}
