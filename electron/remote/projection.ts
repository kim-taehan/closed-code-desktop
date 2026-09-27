import type { ChatMessage } from '../../shared/ipc/messageTypes'
import type { ChatSnapshotPayload, SessionStatePayload } from '../../shared/ipc/channels'
import type { TurnEvent } from '../../shared/ipc/turnEvent'
import type { OutboundFrame, PendingInterrupt, ProjectedMessage } from './frames'

// 프로젝트 하나를 휴대폰에 비추는 투영 (`mobile/protocol/PROTOCOL.md` §4-1).
//
// ## 왜 스냅숏을 그대로 못 보내나
//
// `SessionBridge` 가 화면에 보내는 것은 **대화 전체 스냅숏**이고, 글 조각마다 한 번씩 나간다
// (계획 §2: 50KB 대화 × 초당 20조각 ≈ 1MB/s). BLE 로는 불가다 — 기본 MTU 23바이트, 협상해도
// Android ~517 이다. 그래서 여기서 **직전 스냅숏과 비교해 덧붙은 만큼만** `delta` 로 낸다.
//
// 델타가 이 자리에 있는 이유: `TurnEvent` 의 `text` 는 이미 조각이지만 **어느 메시지에 붙는지
// (`messageId`)가 없다** (§4-1 의 「왜 `turn` 에서 `text` 를 빼고 `delta` 를 따로 두나」). 렌더러는
// 스냅숏으로 버블 경계를 그려서 문제가 안 되지만 휴대폰은 스냅숏을 매번 받을 수 없다.
//
// ## 순수하게 둔다 — 시계가 없다
//
// §4-1 의 투영 규칙은 「`delta` 를 250ms 창에서 합쳐 보낸다」를 제안한다. **이번에는 안 넣었다.**
// 초당 바이트를 줄이는 몫은 거의 전부 **차이 계산**에서 나오고(1MB/s → 델타 몇십 바이트),
// 창 합치기는 작은 덧붙임 여럿을 하나로 묶는 추가 이득일 뿐인데 타이머 하나를 들여 그 수명을
// 링크 수명에 묶어야 한다 (감사 축 A7 의 자리다). 계획 §10 이 수치를 구현자에게 맡긴 자리라
// **묶기는 전송이 붙어 실제 처리량을 잰 뒤에 정한다.**
//
// ⚠️ **자르기와 델타가 겹치는 자리** (v0 의 알려진 한계): `snapshot` 은 메시지당 상한에서 content 를
// 자르고 `contentTruncated` 를 찍지만, 델타의 기준선은 **자르기 전 전체 글**이다. 그래서 잘린
// 스냅숏을 받은 휴대폰은 이후 델타를 이어 붙이며 가운데가 빈 글을 갖는다 — 그 메시지에
// `contentTruncated` 가 찍혀 있어 휴대폰이 「여기는 잘렸다」를 그릴 수 있다는 것이 지금의 답이다.

export interface ProjectionLimits {
  /** `snapshot` 에 실을 최근 메시지 수 (§4-1 제안 50) */
  recentMessages: number
  /** 메시지당 content 상한 바이트 (§4-1 제안 8 KiB) */
  contentBytes: number
  /**
   * `snapshot` 한 건의 content 총합 상한.
   *
   * **§4-1 의 두 제안값만으로는 모자란다**: 50 × 8 KiB = 400 KiB 이고 §2 의 메시지 상한은
   * 256 KiB 다. 긴 대화에서 다시 맞추면 그 프레임이 상한에 걸려 **버려지고**, 증상은
   * 「휴대폰이 영영 다시 맞추지 못한다」로 나타난다. 그래서 총합 예산을 따로 둔다 —
   * JSON 겉봉·필드 이름이 붙을 자리를 남겨 상한의 절반으로 잡았다.
   */
  totalBytes: number
}

export const DEFAULT_LIMITS: ProjectionLimits = {
  recentMessages: 50,
  contentBytes: 8 * 1024,
  totalBytes: 128 * 1024,
}

export class ProjectProjection {
  /**
   * 직전 스냅숏의 메시지 — **휴대폰에 이미 말한 것**이고 델타의 기준선이다.
   *
   * 글만 아니라 메시지째 쥐는 이유는 `resync()` 다: 다시 맞출 때 `author`·`kind` 를 다시
   * 만들어 낼 수 없다 (글만 기억하면 전부 assistant·text 로 보내게 된다).
   */
  private known: readonly ChatMessage[] = []
  /** 위 배열의 id 색인. 스냅숏은 초당 수십 번 오므로 매번 훑지 않는다 */
  private knownById = new Map<string, ChatMessage>()
  /** 답을 기다리는 것들. 키는 requestId·questionId·planId */
  private readonly pending = new Map<string, PendingInterrupt>()
  private state: SessionStatePayload = { handshake: { stage: 'idle' } }

  constructor(
    readonly projectId: string,
    private readonly limits: ProjectionLimits = DEFAULT_LIMITS,
  ) {}

  /** `projects` 프레임이 프로젝트마다 싣는 단계 */
  get stage() {
    return this.state.handshake.stage
  }

  onSessionState(state: SessionStatePayload): OutboundFrame[] {
    this.state = state
    return [this.sessionFrame()]
  }

  /**
   * 턴 이벤트 하나. **`text` 는 버린다** — 같은 글이 `delta` 로 가므로 둘 다 보내면 두 번 간다.
   *
   * 대기 목록은 여기서만 움직인다: 요청 셋이 오면 더하고, 그 턴이 끝나면 지운다.
   * `TurnEvent` 에는 「해결됨」이 없어서(계획 §4 가 찾은 구멍) **누가 답했는지는 알 수 없다** —
   * 답이 들어온 자리를 아는 `resolved` 는 P3 몫이다.
   */
  onTurnEvent(event: TurnEvent): OutboundFrame[] {
    if (event.type === 'text') return []
    const frames: OutboundFrame[] = [
      { v: 0, t: 'turn', projectId: this.projectId, p: event },
    ]
    const before = this.pending.size
    if (event.type === 'approval_requested') {
      const { type: _type, ...rest } = event
      this.pending.set(event.requestId, { kind: 'approval', ...rest })
    } else if (event.type === 'question_requested') {
      const { type: _type, ...rest } = event
      this.pending.set(event.questionId, { kind: 'question', ...rest })
    } else if (event.type === 'plan_requested') {
      const { type: _type, ...rest } = event
      this.pending.set(event.planId, { kind: 'plan', ...rest })
    } else if (event.type === 'turn_ended') {
      for (const [key, item] of [...this.pending]) {
        if (item.turnId === event.turnId) this.pending.delete(key)
      }
    }
    if (this.pending.size !== before) frames.push(this.pendingFrame())
    return frames
  }

  /**
   * 스냅숏 하나 → `delta` 여럿 또는 `snapshot` 하나.
   *
   * 통째로 보내는 조건은 §4-1 그대로다: 아는 메시지의 앞부분이 달라졌거나(덧붙임이 아니다)
   * 알던 메시지가 사라졌다. 대화를 갈아타거나 이력을 불러오면 그렇게 된다.
   */
  onSnapshot(snapshot: ChatSnapshotPayload): OutboundFrame[] {
    const messages = snapshot.messages
    if (this.rewritten(messages)) {
      this.remember(messages)
      return [this.snapshotFrame(messages)]
    }

    const frames: OutboundFrame[] = []
    for (const message of messages) {
      const before = this.sentContent(message.id)
      // 이미 아는 메시지가 그대로다 — 보낼 것이 없다
      if (before !== undefined && before.length === message.content.length) continue
      frames.push({
        v: 0,
        t: 'delta',
        projectId: this.projectId,
        p: {
          messageId: message.id,
          turnId: message.turnId,
          author: message.author,
          kind: message.kind,
          // 처음 보는 메시지는 전체가 덧붙임이다. 글이 없는 메시지(도구 호출 버블)도
          // 빈 덧붙임으로 한 번 알린다 — 그래야 휴대폰이 버블을 그린다
          append: message.content.slice(before?.length ?? 0),
        },
      })
    }
    this.remember(messages)
    return frames
  }

  /**
   * 다시 맞추기 — 휴대폰의 `sync`(§4-2)와 링크 `RESYNC`(§2) 뒤에 부른다.
   *
   * 링크 층이 재전송 버퍼를 안 두는 대신 여기가 지금 아는 것을 통째로 낸다 (§2 「재전송」).
   */
  resync(): OutboundFrame[] {
    return [this.sessionFrame(), this.snapshotFrame(this.known), this.pendingFrame()]
  }

  private sessionFrame(): OutboundFrame {
    return {
      v: 0,
      t: 'session',
      projectId: this.projectId,
      p: { stage: this.state.handshake.stage, connection: this.state.connection },
    }
  }

  private pendingFrame(): OutboundFrame {
    return { v: 0, t: 'pending', projectId: this.projectId, p: { items: [...this.pending.values()] } }
  }

  private snapshotFrame(messages: readonly ChatMessage[]): OutboundFrame {
    const projected = messages.slice(-this.limits.recentMessages).map((message) => this.project(message))
    // 총합 예산을 넘으면 **앞에서부터** 버린다. 최근 것이 보고 싶은 것이고, 하나는 남긴다
    let total = projected.reduce((sum, message) => sum + utf8Length(message.content), 0)
    let start = 0
    while (start < projected.length - 1 && total > this.limits.totalBytes) {
      total -= utf8Length(projected[start]!.content)
      start += 1
    }
    const kept = projected.slice(start)
    return {
      v: 0,
      t: 'snapshot',
      projectId: this.projectId,
      p: { messages: kept, truncated: kept.length < messages.length },
    }
  }

  private project(message: ChatMessage): ProjectedMessage {
    const cut = cutUtf8(message.content, this.limits.contentBytes)
    return {
      id: message.id,
      author: message.author,
      kind: message.kind,
      content: cut,
      ...(cut.length < message.content.length ? { contentTruncated: true } : {}),
      turnId: message.turnId,
      toolName: message.toolName,
      toolCallId: message.toolCallId,
      interrupted: message.interrupted,
      severity: message.severity,
    }
  }

  private remember(messages: readonly ChatMessage[]): void {
    this.known = messages
    this.knownById = new Map(messages.map((message) => [message.id, message]))
  }

  private sentContent(id: string): string | undefined {
    return this.knownById.get(id)?.content
  }

  /** 덧붙임이 아니다 — 앞부분이 달라졌거나 알던 메시지가 사라졌다 */
  private rewritten(messages: readonly ChatMessage[]): boolean {
    for (const message of messages) {
      const before = this.sentContent(message.id)
      if (before !== undefined && !message.content.startsWith(before)) return true
    }
    const ids = new Set(messages.map((message) => message.id))
    return this.known.some((message) => !ids.has(message.id))
  }
}

/**
 * UTF-8 바이트 상한으로 자른다. **글자 경계를 지킨다** — 바이트로 뚝 끊으면 마지막 한글이
 * 깨져 휴대폰에서 U+FFFD 로 보인다 (한글은 3바이트다).
 */
export function cutUtf8(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  let end = maxBytes
  // 이어지는 바이트(10xxxxxx)에서 시작하면 그 글자의 첫 바이트까지 물러난다
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1
  return new TextDecoder().decode(bytes.subarray(0, end))
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}
