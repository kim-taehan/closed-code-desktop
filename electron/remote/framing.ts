// `mobile/protocol/PROTOCOL.md` §2 「링크 조각」의 전부 — 분할·재조립·순번·다시 맞추기.
//
// **정본은 이 파일이 아니라 `mobile/protocol/PROTOCOL.md` 다** (계획 §7). 저쪽이 레포 밖에 있는
// 이유는 desktop 이 조용히 계약을 바꾸지 못하게 하는 것이고, 그래서 여기서 규칙을 「개선」하지
// 않는다 — 고칠 이유를 찾으면 저 문서를 먼저 고친다.
//
// **양방향 순수 함수다.** 전송(BLE·LAN)도, 암호(§3)도, 앱 프레임(§4)도 모르고 바이트만 센다.
// 그래서 시험이 왕복을 직접 돌릴 수 있다 (`framing.test.ts`).
//
// ```
//  0        1        2        3 ...
// +--------+--------+--------+--------------------------+
// | flags  |    seq (u16 BE) | [len u32 BE, FIRST 만] body ...
// +--------+--------+--------+--------------------------+
// flags: bit7 FIRST · bit6 LAST · bit0-3 kind (0=DATA, 1=RESYNC) · bit4-5 예약(0)
// ```
//
// ## 재전송 버퍼가 없다
//
// 링크 층은 **재전송하지 않는다** (§2). 잃은 내용은 앱 층이 되살린다 — 휴대폰이 `sync` 를 보내고
// desktop 이 스냅숏 투영과 대기 목록을 다시 낸다. 그래서 여기 있는 상태는 세 숫자(보낼 seq ·
// 기대하는 seq · 마지막으로 온전히 받은 seq)와 조립 중인 것 하나뿐이다.

/** 한 메시지 상한 (§2). 넘으면 어긋남이다 — 보내는 쪽에서도 거절한다 */
export const MAX_MESSAGE_BYTES = 262_144

/**
 * 협상 전에 가정하는 조각 크기 (§1: 조각 크기 = 협상된 ATT MTU − 3, 기본 MTU 23).
 *
 * 20바이트면 FIRST 조각에 본문이 13바이트만 들어간다 — 시험이 이 값으로 도는 이유다.
 */
export const DEFAULT_FRAGMENT_BYTES = 20

/** FIRST 머리(7바이트)에 본문 한 바이트라도 들어가야 한다 */
export const MIN_FRAGMENT_BYTES = 8

const FLAG_FIRST = 0x80
const FLAG_LAST = 0x40
const KIND_MASK = 0x0f
const KIND_DATA = 0
const KIND_RESYNC = 1
const SEQ_MODULO = 0x1_00_00
const HEADER_BYTES = 3
const LEN_BYTES = 4

/**
 * 받는 쪽이 보는 어긋남 다섯 가지 (§2 「어긋남」).
 *
 * 앞 넷은 이 파일이 판정한다. **`decrypt_failed` 는 못 판정한다** — 복호는 §3(메시지 층)의
 * 일이고 이 파일은 암호를 모른다. 그래서 위층이 `LinkCodec.reject()` 로 들여보내는 문을 뒀다.
 * 다섯을 한 타입에 모으는 이유는 **처리가 같기 때문**이다: 조립 중인 것을 버리고 `RESYNC`.
 */
export type MismatchReason =
  | 'unexpected_seq'
  | 'unexpected_first'
  | 'length_mismatch'
  | 'too_large'
  | 'decrypt_failed'

/** 조각 하나를 먹인 결과 */
export type LinkEvent =
  /** 메시지 하나가 다 왔다 */
  | { kind: 'message'; seq: number; message: Uint8Array }
  /** 아직 조립 중 */
  | { kind: 'partial' }
  /**
   * 상대가 `RESYNC` 를 보냈다 — **우리 보내는 쪽**을 되돌려야 한다 (대기열 비우고 seq=0).
   * `LinkCodec` 이 그 되돌림까지 이미 했다. `seq` 는 상대가 마지막으로 온전히 받은 우리 seq 다.
   */
  | { kind: 'resync_requested'; seq: number }
  /** 어긋났다. `resync` 를 상대에게 그대로 보내면 된다 (조립 중인 것은 이미 버렸다) */
  | { kind: 'mismatch'; reason: MismatchReason; resync: Uint8Array }

/** 65535 다음은 0 (§2) */
export function nextSeq(seq: number): number {
  return (seq + 1) % SEQ_MODULO
}

/**
 * 메시지 하나를 조각들로 (§2). `FIRST` 에만 `len`(메시지 전체 바이트)이 붙는다.
 *
 * `seq` 는 조각마다 늘지 않고 **메시지마다** 늘어서, 한 메시지의 조각은 전부 같은 값을 쓴다.
 *
 * @throws RangeError 상한 초과 또는 조각이 너무 작음
 */
export function fragmentMessage(
  message: Uint8Array,
  seq: number,
  fragmentBytes: number,
): Uint8Array[] {
  if (fragmentBytes < MIN_FRAGMENT_BYTES) {
    throw new RangeError(`조각 크기가 너무 작습니다: ${fragmentBytes} < ${MIN_FRAGMENT_BYTES}`)
  }
  if (message.length > MAX_MESSAGE_BYTES) {
    throw new RangeError(`메시지가 상한을 넘습니다: ${message.length} > ${MAX_MESSAGE_BYTES}`)
  }

  const out: Uint8Array[] = []
  let offset = 0
  let first = true
  // do-while — 빈 메시지도 조각 하나(FIRST|LAST, len 0)로 나간다
  do {
    const header = first ? HEADER_BYTES + LEN_BYTES : HEADER_BYTES
    const take = Math.min(fragmentBytes - header, message.length - offset)
    const last = offset + take >= message.length
    const fragment = new Uint8Array(header + take)
    fragment[0] = (first ? FLAG_FIRST : 0) | (last ? FLAG_LAST : 0) | KIND_DATA
    fragment[1] = (seq >> 8) & 0xff
    fragment[2] = seq & 0xff
    if (first) writeLength(fragment, message.length)
    fragment.set(message.subarray(offset, offset + take), header)
    out.push(fragment)
    offset += take
    first = false
  } while (offset < message.length)
  return out
}

/**
 * `RESYNC` 조각 (§2). `seq` 는 **받는 쪽이 마지막으로 온전히 받은 상대 seq**, 본문 없음.
 *
 * ⚠️ 하나도 못 받은 상태에서 어긋나면 그 값이 없다 — 여기서는 0 을 싣는다. 받는 쪽의 복구는
 * 「내 보낼 seq 를 0 으로」 하나뿐이라 값이 판단을 바꾸지 않지만, **PROTOCOL.md 에 안 적힌
 * 자리**다 (모바일 쪽과 맞출 것으로 남겨 둔다).
 */
export function resyncFragment(seq: number): Uint8Array {
  const fragment = new Uint8Array(HEADER_BYTES)
  fragment[0] = FLAG_FIRST | FLAG_LAST | KIND_RESYNC
  fragment[1] = (seq >> 8) & 0xff
  fragment[2] = seq & 0xff
  return fragment
}

function writeLength(fragment: Uint8Array, length: number): void {
  fragment[3] = (length >>> 24) & 0xff
  fragment[4] = (length >>> 16) & 0xff
  fragment[5] = (length >>> 8) & 0xff
  fragment[6] = length & 0xff
}

function readLength(fragment: Uint8Array): number {
  return (
    ((fragment[3]! << 24) | (fragment[4]! << 16) | (fragment[5]! << 8) | fragment[6]!) >>> 0
  )
}

interface Partial {
  seq: number
  length: number
  chunks: Uint8Array[]
  received: number
}

/**
 * 한 링크(한 연결)의 양방향 상태.
 *
 * **방향마다 독립이다** (§2) — 보내는 seq 와 기대하는 seq 는 따로 센다.
 *
 * @param fragmentBytes 함수다. MTU 는 연결 뒤 협상으로 **바뀐다** (§1: Android `requestMtu(517)`) —
 *   값으로 굳히면 협상 전 20바이트에 영영 묶인다.
 */
export class LinkCodec {
  private sendSeq = 0
  private expectedSeq = 0
  /** 마지막으로 온전히 받은 상대 seq. `RESYNC` 에 싣는다 */
  private lastGoodSeq = 0
  private partial: Partial | null = null

  constructor(private readonly fragmentBytes: () => number = () => DEFAULT_FRAGMENT_BYTES) {}

  /** @throws RangeError 상한(256 KiB) 초과 — 보내는 쪽에서 거절한다 (§2) */
  send(message: Uint8Array): Uint8Array[] {
    const fragments = fragmentMessage(message, this.sendSeq, this.fragmentBytes())
    // seq 는 **보낸 뒤에** 올린다 — 위가 던지면 번호를 건너뛰지 않는다
    this.sendSeq = nextSeq(this.sendSeq)
    return fragments
  }

  receive(fragment: Uint8Array): LinkEvent {
    if (fragment.length < HEADER_BYTES) return this.mismatch('bad_header')
    const flags = fragment[0]!
    const seq = (fragment[1]! << 8) | fragment[2]!

    if ((flags & KIND_MASK) === KIND_RESYNC) {
      // 상대가 다시 맞추자고 했다. **우리 보내는 쪽**을 되돌린다 — 대기열은 링크가 안 쥐므로
      // 되돌릴 것은 번호뿐이다 (머리말 「재전송 버퍼가 없다」).
      this.sendSeq = 0
      this.partial = null
      return { kind: 'resync_requested', seq }
    }

    const first = (flags & FLAG_FIRST) !== 0
    const last = (flags & FLAG_LAST) !== 0

    if (first) {
      // ② 재조립 중에 다른 FIRST. seq 검사보다 먼저 본다 — 조립 중인 것이 있다는 사실 자체가 어긋남이다
      if (this.partial !== null) return this.mismatch('unexpected_first')
      if (fragment.length < HEADER_BYTES + LEN_BYTES) return this.mismatch('bad_header')
      const length = readLength(fragment)
      // ④ 상한 초과
      if (length > MAX_MESSAGE_BYTES) return this.mismatch('too_large')
      // ① 기대한 seq 가 아니다
      if (seq !== this.expectedSeq) return this.mismatch('unexpected_seq')
      this.partial = { seq, length, chunks: [], received: 0 }
      return this.accumulate(fragment.subarray(HEADER_BYTES + LEN_BYTES), last)
    }

    // 이어지는 조각. 조립 중인 것이 없거나 번호가 다르면 ① 이다 —
    // 「기대한 조각이 아니다」의 다른 얼굴이라 사유를 따로 두지 않는다 (§2 는 다섯 가지뿐이다).
    if (this.partial === null || this.partial.seq !== seq) return this.mismatch('unexpected_seq')
    return this.accumulate(fragment.subarray(HEADER_BYTES), last)
  }

  /**
   * 위층(§3 메시지 층)이 온전히 받은 메시지를 거절했다 — 다섯째 어긋남(복호 실패).
   *
   * 링크 층은 복호를 모르므로 이 문으로만 그 경우가 들어온다. 처리는 나머지 넷과 같다.
   * (§3 의 「3회 연속이면 끊는다」는 암호가 붙는 다음 몫이다 — 세는 곳이 여기가 아니다.)
   */
  reject(reason: MismatchReason = 'decrypt_failed'): { reason: MismatchReason; resync: Uint8Array } {
    const event = this.mismatch(reason)
    return { reason, resync: event.resync }
  }

  private accumulate(body: Uint8Array, last: boolean): LinkEvent {
    const partial = this.partial!
    partial.chunks.push(body)
    partial.received += body.length
    // ③ 길이가 안 맞는다 — LAST 를 기다리지 않고 넘치는 순간 끊는다 (안 하면 무한히 쌓인다)
    if (partial.received > partial.length) return this.mismatch('length_mismatch')
    if (!last) return { kind: 'partial' }
    if (partial.received !== partial.length) return this.mismatch('length_mismatch')

    const message = new Uint8Array(partial.length)
    let offset = 0
    for (const chunk of partial.chunks) {
      message.set(chunk, offset)
      offset += chunk.length
    }
    this.partial = null
    this.lastGoodSeq = partial.seq
    this.expectedSeq = nextSeq(partial.seq)
    return { kind: 'message', seq: partial.seq, message }
  }

  /**
   * 조립 중인 것을 버리고 `RESYNC` 를 만든다.
   *
   * **기대값도 0 으로 되돌린다** (§2: 「받는 쪽도 기대값을 0 으로」). 안 되돌리면 상대가 0 부터
   * 다시 보내는데 우리는 옛 번호를 기다려 영영 어긋난다.
   */
  private mismatch(reason: MismatchReason | 'bad_header'): {
    kind: 'mismatch'
    reason: MismatchReason
    resync: Uint8Array
  } {
    this.partial = null
    const resync = resyncFragment(this.lastGoodSeq)
    this.expectedSeq = 0
    // 머리가 모자란 조각은 §2 의 다섯에 이름이 없다 — 「기대한 조각이 아니다」로 셈한다
    const named: MismatchReason = reason === 'bad_header' ? 'unexpected_seq' : reason
    return { kind: 'mismatch', reason: named, resync }
  }
}
