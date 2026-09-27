import { Channel, type ChatSnapshotPayload, type SessionStatePayload } from '../../shared/ipc/channels'
import type { AppSettings } from '../../shared/settings/appSettings'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import type { TurnEvent } from '../../shared/ipc/turnEvent'
import type { FrameMirror } from '../ipc/frameSink'
import { LinkCodec, MAX_MESSAGE_BYTES } from './framing'
import type { InboundCommand, OutboundFrame, RejectCode } from './frames'
import { parseInbound } from './inbound'
import { ProjectProjection } from './projection'
import type { RemoteLink } from './link'

// 원격 채널의 한가운데 — 프레임의 **세 번째 소비자**다 (렌더러·확장 호스트 다음).
//
// ## 격리는 약해지지 않는다
//
// 여기 들어오는 프레임은 `SessionBridge.push` 가 이미 내보낸 것이고, 그것은 어댑터의
// `admits`(`electron/opencode/sessionFilter.ts`)를 **이미 통과했다** (계획 §4). 그래서 이 층은
// opencode `/event` 를 직접 구독하지 않고 `opencode/client.ts` 를 부르지도 않는다 — 부르면
// 격리를 막는 자리가 둘이 되고, 둘 중 하나만 고치면 남의 대화가 휴대폰으로 샌다.
// 그 위에 이 층이 더하는 격리가 하나 더 있다: **구독(`subscribe`)한 프로젝트만** 나간다.
//
// 확장 AI 세션(`electron/opencode/extensionRun.ts`)의 이벤트는 여기 아예 오지 않는다 —
// 그쪽은 확장 호스트로 가는 다른 길이다. `SessionBridge.push` 를 지나는 확장 프레임은
// `EXTENSION_CHAT_ASK`(확장이 사용자 대화에 묻는 것) 하나뿐이고, 아래 `mirror` 의 채널
// 스위치가 그것을 떨어뜨린다 (`remoteIsolation.test.ts` 가 잠근다).
//
// ## 수명 — 창이 아니라 앱이다 (감사 축 A7)
//
// `SessionBridge` 는 **창마다** 새로 생기고(`main.ts`) 이 서비스는 **앱 수명**이다. 그래서 이
// 클래스는 브리지도 창도 레지스트리도 붙들지 않는다 — 프레임은 브리지가 밀어 넣고(`mirror`),
// 프로젝트 목록은 `deps.projects()` 를 **그때그때 읽는다** (선례: `electron/mcp/appWiring.ts`).
// 이 레포는 이 축에서 차단급 누출을 낸 전례가 있다 (죽은 창을 영영 바라보던 MCP 포트).

export interface RemoteDeps {
  /** 스위치. 설정탭에서 바뀌므로 붙을 때마다 다시 읽는다 */
  settings: () => Promise<AppSettings>
  /** 지금 열린 프로젝트. 창 수명 레지스트리를 **함수로** 읽는다 */
  projects: () => ProjectRecord[]
  log?: (line: string) => void
}

export class RemoteService {
  private link: RemoteLink | null = null
  private codec: LinkCodec | null = null
  /** 설정이 켜진 채로 붙었나. 꺼져 있으면 `attach` 자체가 거절한다 */
  private enabled = false
  private approvals = false
  /**
   * 휴대폰 이름. `hello`(§4-2) 를 받기 전에는 null 이고 **그동안 프레임은 0건**이다.
   *
   * ⚠️ 이것은 §3-3 의 「사용자가 desktop 에서 허용하기 전엔 앱 프레임 0」의 **자리만 잡은 것**이다.
   * 지문 표시·신뢰 목록·Noise 핸드셰이크가 아직 없어서, 지금 이 관문은 「hello 를 보냈는가」만 본다.
   * 전송(BLE)을 붙이기 전에 그 셋이 먼저 와야 한다 (`link.ts` 머리말의 같은 경고).
   */
  private device: string | null = null
  private readonly subscribed = new Set<string>()
  private readonly projections = new Map<string, ProjectProjection>()

  constructor(private readonly deps: RemoteDeps) {}

  /**
   * 전송이 붙었다. **설정이 꺼져 있으면 붙이지 않는다** (루트 `CLAUDE.md` 핵심 원칙: mobile 이
   * 없어도 desktop 은 온전히 돈다 → 기본 꺼짐이고 꺼져 있으면 광고도 안 한다).
   *
   * ⚠️ 연결 중에 설정을 끄면 **이미 붙은 것은 여기서 끊기지 않는다.** 끊는 자리는 광고를 멈추는
   * 자리와 같아서 전송이 붙는 다음 몫이다 (지금은 `attach` 를 부르는 프로덕션 호출자가 없다).
   */
  async attach(link: RemoteLink): Promise<boolean> {
    const settings = await this.deps.settings()
    if (!settings.remoteEnabled) {
      this.log('원격 허용이 꺼져 있어 연결을 거절했습니다')
      link.close()
      return false
    }
    this.detach()
    this.enabled = true
    this.approvals = settings.remoteApprovals
    this.link = link
    this.codec = new LinkCodec(() => link.fragmentBytes)
    link.onFragment((fragment) => this.onFragment(fragment))
    link.onClose(() => this.detach())
    return true
  }

  /** 끊겼다. **휴대폰에 대한 기억을 전부 버린다** — 다음 연결은 `hello` 부터 다시 한다 */
  detach(): void {
    const link = this.link
    this.link = null
    this.codec = null
    this.enabled = false
    this.approvals = false
    this.device = null
    this.subscribed.clear()
    this.projections.clear()
    link?.close()
  }

  dispose(): void {
    this.detach()
  }

  /**
   * `SessionBridge.push` 의 미러 (`electron/ipc/frameSink.ts`).
   *
   * **동기이고 던지지 않는다.** 렌더러 팬아웃과 같은 호출 안에서 도므로, 여기서 시간을 쓰거나
   * 예외를 내면 화면이 그 값을 치른다 (막아 주는 곳은 `FrameSink` 이지만 기대지 않는다).
   */
  readonly mirror: FrameMirror = (channel, projectId, payload) => {
    if (this.link === null || !this.enabled || this.device === null) return
    const projection = this.projections.get(projectId)
    // 구독하지 않은 프로젝트는 투영 자체가 없다 — 격리의 두 번째 겹이다
    if (projection === undefined) return
    switch (channel) {
      case Channel.SESSION_STATE:
        this.emit(projection.onSessionState(payload as SessionStatePayload))
        return
      case Channel.TURN_EVENT:
        this.emit(projection.onTurnEvent(payload as TurnEvent))
        return
      case Channel.CHAT_SNAPSHOT:
        this.emit(projection.onSnapshot(payload as ChatSnapshotPayload))
        return
      default:
        // 나머지 채널은 §4-1 에 대응하는 프레임이 없다 — 확장이 사용자 대화에 묻는
        // `EXTENSION_CHAT_ASK`, 알림, 이력·리뷰·MCP·모델 상태, 권한 모드, 작업 디렉터리.
        // **여집합을 적어 막지 않는다**: 새 채널이 생겨도 기본이 「안 보낸다」여야 한다.
        return
    }
  }

  private onFragment(fragment: Uint8Array): void {
    const codec = this.codec
    if (codec === null) return
    const event = codec.receive(fragment)
    if (event.kind === 'partial') return
    if (event.kind === 'message') {
      this.onMessage(event.message)
      return
    }
    if (event.kind === 'mismatch') {
      this.log(`링크 어긋남(${event.reason}) — RESYNC 를 보냅니다`)
      this.link?.send(event.resync)
      return
    }
    // 상대가 RESYNC 를 보냈다. 보낼 번호는 `LinkCodec` 이 이미 0 으로 되돌렸고, **잃은 내용을
    // 여기서 다시 밀지 않는다** — 휴대폰이 구독한 프로젝트마다 `sync` 를 보낸다 (§2 「재전송」).
    this.log('휴대폰이 다시 맞추기를 요청했습니다 — sync 를 기다립니다')
  }

  private onMessage(message: Uint8Array): void {
    const parsed = parseInbound(message)
    if (!parsed.ok) {
      this.emit([
        {
          v: 0,
          t: 'reject',
          ...(parsed.id === undefined ? {} : { id: parsed.id }),
          ...(parsed.projectId === undefined ? {} : { projectId: parsed.projectId }),
          p: { code: parsed.code, message: parsed.message },
        },
      ])
      return
    }
    this.run(parsed.command)
  }

  private run(command: InboundCommand): void {
    switch (command.t) {
      case 'hello':
        this.device = command.p.deviceName
        this.log(`원격 기기가 붙었습니다: ${command.p.deviceName}`)
        this.emit([
          {
            v: 0,
            t: 'hello',
            p: {
              protocol: 0,
              approvalsAllowed: this.approvals,
              maxMessageBytes: MAX_MESSAGE_BYTES,
            },
          },
          { v: 0, t: 'projects', p: { projects: this.projectList() } },
          { v: 0, t: 'ack', id: command.id },
        ])
        return
      case 'subscribe':
        this.subscribe(command)
        return
      case 'sync': {
        const projection = this.projections.get(command.projectId)
        if (projection === undefined) {
          this.reject(command.id, 'unknown_project', '구독하지 않은 프로젝트입니다', command.projectId)
          return
        }
        this.emit([{ v: 0, t: 'ack', id: command.id, projectId: command.projectId }, ...projection.resync()])
        return
      }
    }
  }

  private subscribe(command: { id: string; p: { projectIds: string[] } }): void {
    const open = new Set(this.deps.projects().map((project) => project.id))
    const unknown = command.p.projectIds.find((id) => !open.has(id))
    if (unknown !== undefined) {
      this.reject(command.id, 'unknown_project', '열린 프로젝트가 아닙니다', unknown)
      return
    }
    this.subscribed.clear()
    this.projections.clear()
    for (const id of command.p.projectIds) {
      this.subscribed.add(id)
      this.projections.set(id, new ProjectProjection(id))
    }
    this.emit([{ v: 0, t: 'ack', id: command.id }])
  }

  private projectList() {
    return this.deps.projects().map((project) => ({
      projectId: project.id,
      name: project.name,
      stage: this.projections.get(project.id)?.stage ?? ('idle' as const),
    }))
  }

  private reject(id: string, code: RejectCode, message: string, projectId?: string): void {
    this.emit([{ v: 0, t: 'reject', id, ...(projectId === undefined ? {} : { projectId }), p: { code, message } }])
  }

  /**
   * 프레임들을 링크로. 프레임 하나 = 링크 메시지 하나 = 조각 여럿 (§2).
   *
   * 상한(256 KiB)을 넘는 프레임은 **버리고 적는다.** 조각으로 쪼개 보내면 받는 쪽이 `len` 검사에서
   * 어긋남으로 판정해 연결이 `RESYNC` 를 왕복하는 것으로 끝난다 — 그 자리를 이쪽에서 먼저 닫는다.
   */
  private emit(frames: readonly OutboundFrame[]): void {
    const link = this.link
    const codec = this.codec
    if (link === null || codec === null) return
    for (const frame of frames) {
      const bytes = new TextEncoder().encode(JSON.stringify(frame))
      let fragments: Uint8Array[]
      try {
        fragments = codec.send(bytes)
      } catch (error) {
        this.log(`프레임이 너무 커서 버렸습니다 (${frame.t}, ${bytes.length}바이트): ${String(error)}`)
        continue
      }
      for (const fragment of fragments) link.send(fragment)
    }
  }

  private log(line: string): void {
    this.deps.log?.(`[remote] ${line}`)
  }
}
