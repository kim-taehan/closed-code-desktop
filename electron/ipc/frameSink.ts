import type { BrowserWindow } from 'electron'
import type { ProjectScoped } from '../../shared/ipc/channels'

// 프로젝트 겉봉을 씌워 프레임을 내보내는 자리. `bridge.ts` 의 `push` 를 그대로 옮겼다.
//
// **줄 수를 벌려고 옮긴 것이 아니다** (`desktop/CLAUDE.md` 가 거절하는 거래). 옮긴 이유는
// 행동이 바뀌었기 때문이다: 프레임의 소비자가 **둘**이 됐다 — 렌더러와 원격 채널
// (`electron/remote/`, 계획 §4). 그 판단(누가 먼저인가·예외를 누가 먹는가)이 `bridge.ts` 에
// 들어갈 자리가 없었다. 선례는 `electron/opencode/sessionFilter.ts` 추출이다.
//
// ## 순서와 예외가 이 파일의 내용이다
//
// 1. **렌더러가 먼저다.** 화면은 사용자가 보고 있는 것이고 원격은 곁다리다.
// 2. **미러의 예외를 여기서 먹는다.** 원격 쪽이 던지면 `SessionBridge.push` 가 터지고, 그건
//    그 프레임을 낸 세션 리스너까지 거슬러 올라간다 — 휴대폰 코드의 버그가 데스크탑 채팅을
//    멈추는 길이 된다. 그래서 미러는 **동기·무예외**로 약속하고 그래도 한 번 더 감싼다.
// 3. **`electron/ipc/` 는 `electron/remote/` 를 import 하지 않는다.** 원격은 IPC 층 **위**에 앉으므로
//    (계획 §4) 아래가 위를 알면 안 된다. 그래서 미러는 함수로 주입받는다.

/**
 * 프레임 하나의 두 번째 소비자.
 *
 * 받는 것은 `admits`(`electron/opencode/sessionFilter.ts`)를 **이미 통과한** 프레임뿐이다 —
 * 원격 채널이 자기 `/event` 를 열지 않는 근거가 이것이다 (계획 §4).
 */
export type FrameMirror = (channel: string, projectId: string, payload: unknown) => void

export class FrameSink {
  constructor(
    private readonly window: BrowserWindow,
    private readonly mirror: FrameMirror | null = null,
  ) {}

  /** 창이 아직 살아 있나. 확장 `chat.ask` 가 화면 큐에 밀어 넣기 전에 본다 */
  get alive(): boolean {
    return !this.window.isDestroyed()
  }

  /** 비활성 프로젝트 이벤트도 그대로 보낸다 — 안 그려도 배지는 갱신해야 한다 (설계 §5). */
  push(channel: string, projectId: string, payload: unknown): void {
    if (this.window.isDestroyed()) return
    const scoped: ProjectScoped<unknown> = { projectId, payload }
    this.window.webContents.send(channel, scoped)
    if (this.mirror === null) return
    try {
      this.mirror(channel, projectId, payload)
    } catch (error) {
      // 원격 한 프레임을 잃는 것이 채팅을 멈추는 것보다 싸다 (머리말 2)
      console.warn(`[remote] 미러가 실패했습니다 (${channel}): ${String(error)}`)
    }
  }
}
