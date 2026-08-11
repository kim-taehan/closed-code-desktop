import { parseInbound } from '../../shared/protocol/envelope'
import { Action, Kind } from '../../shared/protocol/kinds'
import { HandlerSet, type Transport, type Unsubscribe } from '../ws/transport'
import { asBoolean, asString } from './chunkFields'
import {
  WORKING_DIR_INACTIVE,
  type WorkingDirPayload as WorkingDirState,
} from '../../shared/protocol/workingDir'

// 현재 세션 작업 경로 (ADR-036 / DC-1146).
//
// set_working_directory 로 작업 경로가 워크스페이스 밖으로 나가면 runtime 이
// working_dir_state 를 push 한다. **받기만 한다** — 경로를 정하는 건 runtime 이고,
// 여기서 먼저 보내거나 추측하면 화면과 실제 실행 위치가 어긋난다.
//
// worktree 는 별도 worktree_state 가 담당하므로 여기서는 directory/external 만 온다.

// 타입·상수는 프로토콜 쪽이 정본이다. 쓰던 곳이 계속 여기서 가져다 쓰도록 다시 내보낸다.
export { WORKING_DIR_INACTIVE, type WorkingDirState }

export class WorkingDirController {
  private state: WorkingDirState = WORKING_DIR_INACTIVE
  private unsubscribe: Unsubscribe | null = null

  private readonly changeHandlers = new HandlerSet<[WorkingDirState]>()

  constructor(private readonly transport: Transport) {}

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.transport.onMessage((raw) => this.handleMessage(raw))
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.changeHandlers.clear()
  }

  get current(): WorkingDirState {
    return this.state
  }

  onChange(handler: (state: WorkingDirState) => void): Unsubscribe {
    return this.changeHandlers.add(handler)
  }

  /**
   * 연결이 끊기면 override 도 함께 사라진다 — runtime 이 세션 메모리에만 들고 있어서다.
   * 재연결 직후 옛 경로를 그대로 보여주면 "여기서 돌고 있다"는 거짓말이 된다.
   */
  reset(): void {
    if (!this.state.active) return
    this.state = WORKING_DIR_INACTIVE
    this.changeHandlers.emit(this.state)
  }

  private handleMessage(raw: string): void {
    const frame = parseInbound(raw)
    if (!frame || frame.kind !== Kind.WORKSPACE) return
    if (frame.action !== Action.WORKING_DIR_STATE) return

    const next = parseWorkingDirState(frame.data)
    if (!next) return
    if (isSameWorkingDirState(this.state, next)) return

    this.state = next
    this.changeHandlers.emit(next)
  }
}

/**
 * push payload 를 읽는다. active 가 boolean 이 아니면 프레임 자체를 버린다 —
 * 켜졌는지 꺼졌는지 모르는 상태를 화면에 그릴 방법이 없다.
 */
export function parseWorkingDirState(data: unknown): WorkingDirState | null {
  const active = asBoolean((data as Record<string, unknown> | undefined)?.['active'])
  if (active === undefined) return null
  if (!active) return WORKING_DIR_INACTIVE

  const record = data as Record<string, unknown>
  const path = asString(record['path'])
  // active 인데 경로가 없으면 표시할 게 없다. 빈 칩을 띄우느니 꺼진 것으로 본다.
  if (!path) return WORKING_DIR_INACTIVE

  const kind = asString(record['kind'])
  const projectName = asString(record['projectName'])
  return {
    active: true,
    path,
    ...(kind === undefined ? {} : { kind }),
    ...(projectName === undefined ? {} : { projectName }),
  }
}

function isSameWorkingDirState(a: WorkingDirState, b: WorkingDirState): boolean {
  return (
    a.active === b.active &&
    a.path === b.path &&
    a.kind === b.kind &&
    a.projectName === b.projectName
  )
}
