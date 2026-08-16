import { ipcRenderer } from 'electron'
import { Channel, type DesktopBridge, type ProjectHandler } from '../shared/ipc/channels'
import type {
  PtyClosePayload,
  PtyDataPayload,
  PtyDetachPayload,
  PtyExitPayload,
  PtyInputPayload,
  PtyOpenPayload,
  PtyOpenResult,
  PtyResizePayload,
  PtyRunPayload,
  PtyRunResult,
} from '../shared/ipc/ptyPayloads'
import type { RunListPayload, RunListResultPayload } from '../shared/ipc/runBridgeSurface'

// 셸 드로어 배선. `preloadGit.ts` 와 같은 자리·같은 이유다 — preload.ts 가 300줄 상한에
// 붙어 있어 떼어 냈고, preload.ts 가 spread 로 다시 합친다.
// **노출 형태와 메서드 이름은 그대로다.**
//
// ⚠ `wiring.test.ts` 는 `preload*.ts` 를 정규식으로 훑어 invoke 하는 채널을 뽑는다.
// 이 파일도 그 이름 규칙(`preload*.ts`)을 따르므로 자동으로 잡힌다.
//
// **키 입력은 `send` 다 (`invoke` 가 아니다).** 글자를 칠 때마다 도는 자리라 왕복을
// 기다리면 타이핑이 IPC 지연만큼 느려진다. 응답으로 받을 것도 없다 — 화면에 찍히는 것은
// 셸이 되돌려 보내는 에코이지 우리가 보낸 값이 아니다.

/** 겉봉(ProjectScoped)을 벗기는 구독 헬퍼. preload.ts 의 것을 넘겨받는다 — 두 벌을 만들지 않는다. */
type Subscribe = <T>(channel: string, handler: ProjectHandler<T>) => () => void

type PtyBridge = Pick<
  DesktopBridge,
  | 'openShellDrawer'
  | 'sendShellInput'
  | 'resizeShell'
  | 'detachShellDrawer'
  | 'closeShellPane'
  | 'onShellData'
  | 'onShellExit'
  // 사이드바 「실행」 패널의 셋. ▶ 가 같은 pty 배선을 타므로 여기 함께 둔다 —
  // 표면만 `runBridgeSurface.ts` 로 갈라져 있다 (그쪽 머리말).
  | 'runShellPane'
  | 'readRunList'
  | 'onRunListChanged'
>

export function ptyBridge(subscribe: Subscribe): PtyBridge {
  return {
    openShellDrawer: (payload: PtyOpenPayload) =>
      ipcRenderer.invoke(Channel.PTY_OPEN, payload) as Promise<PtyOpenResult>,
    sendShellInput: (payload: PtyInputPayload) => ipcRenderer.send(Channel.PTY_INPUT, payload),
    resizeShell: (payload: PtyResizePayload) =>
      ipcRenderer.invoke(Channel.PTY_RESIZE, payload) as Promise<void>,
    detachShellDrawer: (payload: PtyDetachPayload) => ipcRenderer.send(Channel.PTY_DETACH, payload),
    // 닫기는 `invoke` 다 — pty 를 서버에서 지우는 왕복이라, 끝나기를 기다려야 화면이
    // 「닫혔다」로 넘어갈 수 있다 (키 입력과 성격이 반대다)
    closeShellPane: (payload: PtyClosePayload) =>
      ipcRenderer.invoke(Channel.PTY_CLOSE, payload) as Promise<void>,
    onShellData: (handler: ProjectHandler<PtyDataPayload>) =>
      subscribe<PtyDataPayload>(Channel.PTY_DATA, handler),
    onShellExit: (handler: ProjectHandler<PtyExitPayload>) =>
      subscribe<PtyExitPayload>(Channel.PTY_EXIT, handler),
    // ▶ 도 `invoke` 다 — 화면은 이 왕복이 끝난 **뒤에** 탭을 만들어야 한다 (`PTY_RUN` 머리말)
    runShellPane: (payload: PtyRunPayload) =>
      ipcRenderer.invoke(Channel.PTY_RUN, payload) as Promise<PtyRunResult>,
    // 목록은 프로젝트 밖(앱 저장소)에 있어 `readFile` 로는 못 닿는다 (`runBridgeSurface.ts`)
    readRunList: (payload: RunListPayload) =>
      ipcRenderer.invoke(Channel.RUN_LIST_READ, payload) as Promise<RunListResultPayload>,
    onRunListChanged: (handler: ProjectHandler<Record<string, never>>) =>
      subscribe<Record<string, never>>(Channel.RUN_LIST_CHANGED, handler),
  }
}
