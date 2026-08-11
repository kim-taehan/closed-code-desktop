import { createEnvelope, parseInbound, serializeEnvelope } from '../../shared/protocol/envelope'
import { Action, AuthState, Kind, WorkspaceState } from '../../shared/protocol/kinds'
import type { HandshakeFailure, HandshakeStage, HandshakeState } from '../../shared/ipc/sessionTypes'
import { HandlerSet, type Transport, type Unsubscribe } from '../ws/transport'

// 설계 §4.2 핸드셰이크 4단계 상태머신.
//
// 이 모듈의 설계 목표는 "성공"이 아니라 "실패 지점의 가시성"이다.
// 선행 시도에서 채팅이 안 됐다면 십중팔구 이 네 단계 중 하나이며,
// 어느 단계에서 무엇을 기다리다 멈췄는지가 상태값과 오류 메시지에 그대로 드러나야 한다.

export type { HandshakeFailure, HandshakeStage, HandshakeState } from '../../shared/ipc/sessionTypes'

export interface HandshakeOptions {
  workspacePath: string
  /** 표시용 프로젝트 이름. workspace_sync 의 projectName 으로 나간다 (없으면 경로 basename). */
  projectName?: string
  /** runtime 은 vscode|eclipse|intellij 만 인식하고 그 외는 미설정으로 취급한다 */
  ideType?: string
  pluginVersion?: string
  timeouts?: Partial<Record<'connected' | 'auth' | 'workspace', number>>
}

const DEFAULT_TIMEOUTS = { connected: 10_000, auth: 15_000, workspace: 30_000 }

/**
 * 인증 응답인지 payload 모양으로 판정한다. action 이름으로 판정하지 않는다.
 *
 * 실측(runtime 3.4.3): 인증 결과는 `action: "auth_state"` 가 아니라
 * 요청 action 을 그대로 에코한 `action: "auth_request"` 로 돌아온다.
 * 문서와 어긋나는 지점이며, vscode 확장도 MessageConverter 에서
 * auth_state 와 auth_request 를 모두 인식 목록에 넣어 이를 견디고 있다.
 * action 이름에 기대면 runtime 버전에 따라 핸드셰이크가 조용히 멈춘다.
 */
function isAuthStatePayload(data: unknown): boolean {
  if (data === null || typeof data !== 'object') return false
  return typeof (data as Record<string, unknown>)['state'] === 'string'
}

/** 단계별로 무엇을 기다리는지 — 타임아웃 메시지에 그대로 쓴다 */
const AWAITING: Record<string, string> = {
  awaiting_connected: 'system/connected 프레임을',
  authenticating: 'auth_state.state === "valid" 응답을',
  syncing_workspace: 'workspace_state.state === "ready" 응답을',
}

export class Handshake {
  private stage: HandshakeStage = 'idle'
  private failure: HandshakeFailure | undefined
  private unsubscribe: Unsubscribe | null = null
  private unsubscribeOpen: Unsubscribe | null = null
  private timer: NodeJS.Timeout | null = null
  private settle: { resolve: () => void; reject: (error: Error) => void } | null = null

  private readonly stateHandlers = new HandlerSet<[HandshakeState]>()
  private readonly timeouts: Record<'connected' | 'auth' | 'workspace', number>

  constructor(
    private readonly transport: Transport,
    private readonly options: HandshakeOptions,
  ) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts }
  }

  get state(): HandshakeState {
    return this.failure ? { stage: this.stage, failure: this.failure } : { stage: this.stage }
  }

  onStateChange(handler: (state: HandshakeState) => void): Unsubscribe {
    return this.stateHandlers.add(handler)
  }

  /** ready 에 도달하면 resolve, 어느 단계든 실패하면 그 단계를 담아 reject */
  run(): Promise<void> {
    if (this.stage !== 'idle') {
      return Promise.reject(new Error(`핸드셰이크가 이미 ${this.stage} 상태입니다`))
    }
    return new Promise<void>((resolve, reject) => {
      this.settle = { resolve, reject }
      this.unsubscribe = this.transport.onMessage((raw) => this.handleMessage(raw))

      // 단계 타이머는 소켓이 열린 뒤에 건다.
      // run() 시점에 걸면 연결 지연과 경쟁해 "연결이 느렸을 뿐인데 핸드셰이크 실패"가 된다.
      // 연결 자체의 실패·타임아웃은 WsConnection 의 책임이다.
      // 소켓이 **다시** 열렸으면 처음부터 새로 한다.
      //
      // 재연결로 열린 소켓은 runtime 입장에서 완전히 새 세션이다 — 인증도 workspace_sync 도
      // 다시 받아야 한다. 그런데 첫 핸드셰이크가 끝나면 stage 가 'ready' 로 굳으므로,
      // 여기서 되돌리지 않으면 새 소켓에 **아무것도 보내지 않고** 앉아 있게 된다.
      // 그 상태로 chat_request 를 보내면 runtime 이 인증 안 된 세션이라 버리고,
      // 화면에서는 "보냈는데 아무 반응이 없다" 로 보인다.
      //
      // 실측 (2026-07-29): backend 502 로 license heartbeat 이 막히자 runtime 이
      // `code=4000 reason='ping watchdog timeout'` 으로 소켓을 끊었다. 데스크톱은
      // conn=open 까지 정상 복구했으나 handshake 는 'ready' 그대로였고, 이후 채팅이
      // 전부 무응답이었다 (runtime 로그에 프레임 도착 흔적 자체가 없음).
      this.unsubscribeOpen = this.transport.onOpen(() => {
        if (this.stage !== 'idle') this.rearm()
        this.enter('awaiting_connected', this.timeouts.connected)
      })
      if (this.transport.isOpen) this.enter('awaiting_connected', this.timeouts.connected)
    })
  }

  dispose(): void {
    this.clearTimer()
    this.unsubscribe?.()
    this.unsubscribe = null
    this.unsubscribeOpen?.()
    this.unsubscribeOpen = null
    this.stateHandlers.clear()
  }

  private handleMessage(raw: string): void {
    const frame = parseInbound(raw)
    if (!frame) return

    if (frame.kind === Kind.SYSTEM && frame.action === Action.CONNECTED) return this.onConnected()
    if (frame.kind === Kind.AUTH && isAuthStatePayload(frame.data)) return this.onAuthState(frame.data)
    if (frame.kind === Kind.WORKSPACE && frame.action === Action.WORKSPACE_STATE) {
      return this.onWorkspaceState(frame.data)
    }
    if (frame.action === Action.ERROR) return this.onErrorFrame(frame.data)
  }

  private onConnected(): void {
    if (this.stage !== 'awaiting_connected') return
    this.enter('authenticating', this.timeouts.auth)

    const sent = this.transport.send(
      serializeEnvelope(
        createEnvelope(Kind.AUTH, Action.AUTH_REQUEST, {
          // **자격증명을 싣지 않는다.** davis 는 `type: 'license_key'` 와
          // `credentials.licenseKey` 를 요구했지만 opencode 에는 라이선스 개념이 없고,
          // 어댑터가 payload 를 보지 않고 늘 valid 로 답한다 (`opencode/transport.ts`).
          // 보안·토큰은 opencode 뒤의 LLM 프록시가 맡는다 — 데스크탑은 알지 않는다.
          // 별칭이 없는 필드라 snake_case 가 정답이다 (설계 §4.1)
          ide_type: this.options.ideType ?? 'desktop',
          plugin_version: this.options.pluginVersion ?? '0.1.0',
        }),
      ),
    )
    if (!sent) this.fail('authenticating', 'auth_request 를 보내지 못했습니다 (소켓이 열려 있지 않음)')
  }

  private onAuthState(data: unknown): void {
    if (this.stage !== 'authenticating') return
    const payload = (data ?? {}) as Record<string, unknown>
    const state = payload['state']

    if (state !== AuthState.VALID) {
      const code = typeof payload['authErrorCode'] === 'string' ? payload['authErrorCode'] : undefined
      const message = typeof payload['message'] === 'string' ? payload['message'] : `state=${String(state)}`
      return this.fail('authenticating', `인증 실패: ${message}`, code)
    }

    this.enter('syncing_workspace', this.timeouts.workspace)
    // 프로젝트를 실어 보낸다 — 비우면 runtime 이 "projects 비어있음"으로 보고
    // workspace_path 를 단일 default project 로 접어, 프로젝트별 이력 스코프가 무너진다.
    const workspacePath = this.options.workspacePath
    const projectName = this.options.projectName || baseName(workspacePath)
    const sent = this.transport.send(
      serializeEnvelope(
        createEnvelope(Kind.WORKSPACE, Action.WORKSPACE_SYNC, {
          workspace: { workspacePath, ideType: this.options.ideType ?? 'desktop' },
          projects: [{ projectName, projectPath: workspacePath }],
        }),
      ),
    )
    if (!sent) this.fail('syncing_workspace', 'workspace_sync 를 보내지 못했습니다 (소켓이 열려 있지 않음)')
  }

  private onWorkspaceState(data: unknown): void {
    if (this.stage !== 'syncing_workspace') return
    const payload = (data ?? {}) as Record<string, unknown>
    // not_ready 는 중간 상태다. ready 만 완료로 친다.
    if (payload['state'] !== WorkspaceState.READY) return

    this.clearTimer()
    this.stage = 'ready'
    this.failure = undefined
    this.stateHandlers.emit(this.state)
    this.settle?.resolve()
    this.settle = null
  }

  private onErrorFrame(data: unknown): void {
    if (this.stage === 'ready' || this.stage === 'failed') return
    const payload = (data ?? {}) as Record<string, unknown>
    const code = typeof payload['code'] === 'string' ? payload['code'] : undefined
    const message = typeof payload['message'] === 'string' ? payload['message'] : '알 수 없는 오류'
    this.fail(this.stage, `runtime 오류: ${message}`, code)
  }

  /**
   * 재연결 후 다시 걸기 위해 상태를 idle 로 되돌린다.
   *
   * `settle` 은 **건드리지 않는다** — 첫 시도의 promise 는 이미 결판났고(`run()` 의
   * await 는 그때 풀렸다), 여기서 다시 resolve/reject 하면 아무 효과 없이 사라지거나
   * 이미 끝난 호출부를 두 번 깨운다. 재시도 결과는 `onStateChange` 로만 알린다.
   */
  private rearm(): void {
    this.clearTimer()
    this.stage = 'idle'
    this.failure = undefined
  }

  private enter(stage: HandshakeStage, timeoutMs: number): void {
    this.stage = stage
    this.stateHandlers.emit(this.state)
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.fail(stage, `${AWAITING[stage] ?? stage} 기다리다 ${timeoutMs}ms 만에 타임아웃`)
    }, timeoutMs)
  }

  private fail(stage: HandshakeStage, reason: string, code?: string): void {
    if (this.stage === 'failed' || this.stage === 'ready') return
    this.clearTimer()
    this.failure = code === undefined ? { stage, reason } : { stage, reason, code }
    this.stage = 'failed'
    this.stateHandlers.emit(this.state)

    const error = new Error(`[${stage}] ${reason}`)
    Object.assign(error, { stage, code })
    this.settle?.reject(error)
    this.settle = null
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

/** 절대경로에서 마지막 이름만. projectName 기본값에 쓴다. */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
