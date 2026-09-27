import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FRAGMENT_BYTES,
  LinkCodec,
  MAX_MESSAGE_BYTES,
  fragmentMessage,
  nextSeq,
  resyncFragment,
} from './framing'

// `mobile/protocol/PROTOCOL.md` §2 를 잠근다 — 계획 §9 P1 ⑤ 「조각 왕복」.
//
// 이 층은 **순수 함수**라 시험이 실물 없이 전부 돈다. 그래서 여기가 원격 채널의 회귀 그물이
// 아니라 **결함 탐지기**다: 조각 하나를 바꾸면 빨개진다 (되돌리기 표는 보고서에 있다).
//
// 조각 크기는 일부러 협상 전 값(20바이트)을 쓴다 — FIRST 에 본문이 13바이트만 들어가서
// 한 줄짜리 JSON 도 조각 여럿이 된다. 협상된 517 로만 재면 분할 자체가 안 돈다.

/** 두 codec 을 마주 놓는다 — 방향마다 독립이라 한 쌍이면 왕복이 된다 */
function pair(fragmentBytes = DEFAULT_FRAGMENT_BYTES) {
  const left = new LinkCodec(() => fragmentBytes)
  const right = new LinkCodec(() => fragmentBytes)
  return { left, right }
}

function roundTrip(codec: LinkCodec, receiver: LinkCodec, message: Uint8Array): Uint8Array {
  const out: Uint8Array[] = []
  for (const fragment of codec.send(message)) {
    const event = receiver.receive(fragment)
    if (event.kind === 'message') out.push(event.message)
    else if (event.kind !== 'partial') throw new Error(`어긋남: ${JSON.stringify(event)}`)
  }
  expect(out).toHaveLength(1)
  return out[0]!
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function seqOf(fragment: Uint8Array): number {
  return (fragment[1]! << 8) | fragment[2]!
}

describe('조각 분할·재조립 (§2)', () => {
  it('MTU 20바이트에서 쪼갠 것이 원본으로 돌아온다 — 한글 포함', () => {
    const { left, right } = pair()
    const message = utf8(JSON.stringify({ v: 0, t: 'delta', p: { append: '안녕하세요 '.repeat(20) } }))
    expect(fragmentMessage(message, 0, 20).length).toBeGreaterThan(5)
    expect(roundTrip(left, right, message)).toEqual(message)
  })

  it('한 조각에 들어가면 FIRST|LAST 하나로 나간다', () => {
    const fragments = fragmentMessage(utf8('짧다'), 3, 64)
    expect(fragments).toHaveLength(1)
    expect(fragments[0]![0]! & 0xc0).toBe(0xc0)
    expect(seqOf(fragments[0]!)).toBe(3)
  })

  it('seq 는 조각마다 늘지 않고 메시지마다 는다', () => {
    const { left } = pair()
    const many = left.send(utf8('가'.repeat(40)))
    expect(many.length).toBeGreaterThan(1)
    expect(new Set(many.map(seqOf))).toEqual(new Set([0]))
    expect(seqOf(left.send(utf8('나'))[0]!)).toBe(1)
  })

  it('65535 다음은 0 이다 — 보내는 쪽과 기대하는 쪽 모두', () => {
    expect(nextSeq(65535)).toBe(0)
    const { left, right } = pair(64)
    const seen: number[] = []
    // 한 번 감고 한 번 더 — 감는 지점이 양쪽에서 실제로 맞물리는지 본다
    for (let i = 0; i <= 65536; i += 1) {
      const fragments = left.send(utf8('x'))
      seen.push(seqOf(fragments[0]!))
      const event = right.receive(fragments[0]!)
      expect(event.kind).toBe('message')
    }
    expect(seen[65535]).toBe(65535)
    expect(seen[65536]).toBe(0)
  })

  it('상한(256 KiB)을 넘기면 보내는 쪽이 거절한다', () => {
    expect(() => fragmentMessage(new Uint8Array(MAX_MESSAGE_BYTES + 1), 0, 64)).toThrow(RangeError)
    expect(() => fragmentMessage(new Uint8Array(MAX_MESSAGE_BYTES), 0, 64)).not.toThrow()
  })
})

describe('어긋남 다섯 가지와 RESYNC (§2)', () => {
  /** FIRST 조각을 손으로 만든다 — 받는 쪽만 겨누려면 보내는 쪽을 통과시킬 수 없다 */
  function first(seq: number, length: number, body: Uint8Array, last = false): Uint8Array {
    const fragment = new Uint8Array(7 + body.length)
    fragment[0] = 0x80 | (last ? 0x40 : 0) // FIRST[|LAST], kind=DATA
    fragment[1] = (seq >> 8) & 0xff
    fragment[2] = seq & 0xff
    fragment[3] = (length >>> 24) & 0xff
    fragment[4] = (length >>> 16) & 0xff
    fragment[5] = (length >>> 8) & 0xff
    fragment[6] = length & 0xff
    fragment.set(body, 7)
    return fragment
  }

  it('① 기대한 seq 가 아니면 어긋난다', () => {
    const codec = new LinkCodec()
    const event = codec.receive(first(7, 1, utf8('a'), true))
    expect(event).toMatchObject({ kind: 'mismatch', reason: 'unexpected_seq' })
  })

  it('② 재조립 중에 다른 FIRST 가 오면 어긋난다', () => {
    const codec = new LinkCodec()
    expect(codec.receive(first(0, 40, utf8('aaa'))).kind).toBe('partial')
    expect(codec.receive(first(1, 3, utf8('bbb'), true))).toMatchObject({
      kind: 'mismatch',
      reason: 'unexpected_first',
    })
  })

  it('③ LAST 에서 누적 길이가 len 과 다르면 어긋난다', () => {
    const codec = new LinkCodec()
    expect(codec.receive(first(0, 40, utf8('aaa'))).kind).toBe('partial')
    // LAST 인데 3+3 ≠ 40
    const last = new Uint8Array([0x40, 0, 0, 0x62, 0x62, 0x62])
    expect(codec.receive(last)).toMatchObject({ kind: 'mismatch', reason: 'length_mismatch' })
  })

  it('③ 길이가 넘치면 LAST 를 기다리지 않고 끊는다 — 무한히 쌓이지 않게', () => {
    const codec = new LinkCodec()
    expect(codec.receive(first(0, 2, utf8('aaaa'))).kind).toBe('mismatch')
  })

  it('④ len 이 상한을 넘으면 어긋난다', () => {
    const codec = new LinkCodec()
    expect(codec.receive(first(0, MAX_MESSAGE_BYTES + 1, utf8('a')))).toMatchObject({
      kind: 'mismatch',
      reason: 'too_large',
    })
  })

  it('⑤ 위층의 복호 실패도 같은 처리로 들어온다', () => {
    const codec = new LinkCodec()
    const rejected = codec.reject()
    expect(rejected.reason).toBe('decrypt_failed')
    // RESYNC 조각이다: FIRST|LAST + kind=1
    expect(rejected.resync[0]).toBe(0xc1)
    expect(rejected.resync).toHaveLength(3)
  })

  it('어긋나면 조립 중인 것을 버리고 기대값을 0 으로 되돌린다', () => {
    const codec = new LinkCodec()
    // **먼저 기대값을 0 이 아닌 곳으로 옮겨 둔다.** 0 인 채로 재면 되돌림을 빼도 초록이 난다
    // (한 번 실제로 그랬다 — 되돌리기 시험이 그것을 잡았다)
    expect(codec.receive(first(0, 1, utf8('a'), true)).kind).toBe('message')
    expect(codec.receive(first(0, 40, utf8('aaa'))).kind).toBe('mismatch') // 기대는 1 인데 0 이 왔다
    expect(codec.receive(first(9, 1, utf8('x'), true)).kind).toBe('mismatch')
    // 되돌렸으니 상대가 0 부터 다시 보내면 통과해야 한다
    expect(codec.receive(first(0, 1, utf8('y'), true))).toMatchObject({ kind: 'message' })
  })

  it('RESYNC 는 마지막으로 온전히 받은 seq 를 싣는다', () => {
    const codec = new LinkCodec()
    expect(codec.receive(first(0, 1, utf8('a'), true)).kind).toBe('message')
    const event = codec.receive(first(9, 1, utf8('b'), true))
    expect(event.kind).toBe('mismatch')
    if (event.kind !== 'mismatch') throw new Error('mismatch 가 아니다')
    expect(seqOf(event.resync)).toBe(0)
  })

  it('RESYNC 를 받으면 보낼 seq 를 0 으로 되돌린다', () => {
    const codec = new LinkCodec(() => 64)
    codec.send(utf8('1'))
    expect(seqOf(codec.send(utf8('2'))[0]!)).toBe(1)
    expect(codec.receive(resyncFragment(1))).toMatchObject({ kind: 'resync_requested', seq: 1 })
    expect(seqOf(codec.send(utf8('3'))[0]!)).toBe(0)
  })
})
