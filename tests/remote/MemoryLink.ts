import { LinkCodec, DEFAULT_FRAGMENT_BYTES } from '../../electron/remote/framing'
import type { OutboundFrame } from '../../electron/remote/frames'
import type { RemoteLink } from '../../electron/remote/link'

// 가짜 전송과 가짜 휴대폰. 선례는 `tests/fake-opencode/` 다 — 그쪽 머리말의 원칙이 여기도 그대로다:
// **실물 계약을 그대로 흉내낸다.** 실물과 어긋난 가짜는 초록을 주면서 버그를 통과시킨다.
//
// 그래서 휴대폰 쪽도 조각을 **제 손으로 쪼개고 재조립한다** (`LinkCodec` 을 desktop 과 따로 하나 쥔다).
// 앱 프레임 객체를 그냥 주고받게 만들면 `PROTOCOL.md` §2 가 시험에서 통째로 빠진다 —
// 지금 이 레포에서 원격이 실제로 밟는 유일한 왕복이 그 층이다.
//
// ⚠️ **§3(암호)은 아직 없다.** 실물이 붙으면 링크 메시지 본문은 `0x10`+카운터+AEAD 가 된다
// (`PROTOCOL.md` §3-4). 그때 이 가짜도 같이 고쳐야 한다 — 안 고치면 위의 「실물과 어긋난 가짜」가 된다.

export class MemoryLink implements RemoteLink {
  /** desktop 이 보낸 조각. 시험은 이것을 세거나(0건 확인) 재조립한다 */
  readonly outbound: Uint8Array[] = []
  closed = false
  private mtu = DEFAULT_FRAGMENT_BYTES
  private fragmentListener: ((fragment: Uint8Array) => void) | null = null
  private closeListener: (() => void) | null = null

  get fragmentBytes(): number {
    return this.mtu
  }

  /** MTU 협상을 흉내낸다 (§1: 휴대폰이 연결 직후 `requestMtu(517)` 을 부른다) */
  negotiate(fragmentBytes: number): void {
    this.mtu = fragmentBytes
  }

  send(fragment: Uint8Array): void {
    if (this.closed) return
    this.outbound.push(fragment.slice())
  }

  onFragment(listener: (fragment: Uint8Array) => void): void {
    this.fragmentListener = listener
  }

  onClose(listener: () => void): void {
    this.closeListener = listener
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.closeListener?.()
  }

  /** 휴대폰이 조각 하나를 써 넣었다 (GATT `RX` write) */
  deliver(fragment: Uint8Array): void {
    this.fragmentListener?.(fragment)
  }
}

/**
 * 휴대폰 쪽. 링크 하나를 쥐고 §2 조각을 제 손으로 다룬다.
 *
 * 한 번 읽은 프레임은 다시 주지 않는다 (`take()`) — 「이 뒤로 몇 건 왔나」가 격리 시험의 질문이다.
 */
export class FakePhone {
  readonly link = new MemoryLink()
  private readonly codec = new LinkCodec(() => this.link.fragmentBytes)
  private read = 0
  private commandId = 0

  /** 명령 하나를 보낸다. `id` 를 안 주면 붙여 준다 (§4-2: 모든 명령은 id 를 싣는다) */
  send(frame: Record<string, unknown>): void {
    const withId = frame['id'] === undefined ? { ...frame, id: `c${++this.commandId}` } : frame
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 0, ...withId }))
    for (const fragment of this.codec.send(bytes)) this.link.deliver(fragment)
  }

  /** 겉봉조차 아닌 것을 보낸다 — `bad_frame` 갈래를 겨눈다 */
  sendRaw(text: string): void {
    for (const fragment of this.codec.send(new TextEncoder().encode(text))) this.link.deliver(fragment)
  }

  /** 아직 안 읽은 나가는 프레임. 조각을 실제로 재조립해서 읽는다 */
  take(): OutboundFrame[] {
    const frames: OutboundFrame[] = []
    while (this.read < this.link.outbound.length) {
      const event = this.codec.receive(this.link.outbound[this.read++]!)
      if (event.kind === 'message') {
        frames.push(JSON.parse(new TextDecoder().decode(event.message)) as OutboundFrame)
      } else if (event.kind === 'mismatch') {
        throw new Error(`desktop 이 보낸 조각이 어긋났습니다: ${event.reason}`)
      }
    }
    return frames
  }

  /** desktop 이 보낸 조각 수. 「프레임 0건」을 재는 가장 낮은 층이다 */
  get fragmentCount(): number {
    return this.link.outbound.length
  }
}
