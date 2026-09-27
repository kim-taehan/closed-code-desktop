import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../shared/ipc/messageTypes'
import type { ChatSnapshotPayload } from '../../shared/ipc/channels'
import { DEFAULT_LIMITS, ProjectProjection, cutUtf8 } from './projection'

// `mobile/protocol/PROTOCOL.md` §4-1 의 투영 규칙을 잠근다.
//
// 여기는 **규칙만** 본다 — 실제 턴을 흘려 최종 글이 맞는지는 `remoteChannel.test.ts` 가
// `FakeOpencodeServer → ProjectSession → SessionBridge → 투영` 으로 잰다 (계획 §9 P1 ①).
// 두 자리가 다른 질문이다: 이쪽은 「규칙이 옳은가」, 저쪽은 「층 사이가 이어졌는가」.

function snapshot(...messages: ChatMessage[]): ChatSnapshotPayload {
  return { messages, turnMetas: [], agentTasks: [] }
}

function assistant(id: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, author: 'assistant', kind: 'text', content, ...extra }
}

function appends(projection: ProjectProjection, payload: ChatSnapshotPayload): string[] {
  return projection.onSnapshot(payload).map((frame) => {
    if (frame.t !== 'delta') throw new Error(`delta 가 아니다: ${frame.t}`)
    return frame.p.append
  })
}

describe('스냅숏 → 델타 (§4-1)', () => {
  it('처음 보는 메시지는 전체가 덧붙임이고, 그 뒤로는 늘어난 만큼만 간다', () => {
    const projection = new ProjectProjection('p1')
    expect(appends(projection, snapshot(assistant('m1', '안녕')))).toEqual(['안녕'])
    expect(appends(projection, snapshot(assistant('m1', '안녕하세요')))).toEqual(['하세요'])
    // 안 바뀌면 아무것도 안 보낸다 — 스냅숏은 조각마다 오므로 이게 대역폭의 전부다
    expect(projection.onSnapshot(snapshot(assistant('m1', '안녕하세요')))).toEqual([])
  })

  it('글이 없는 메시지도 한 번은 알린다 — 도구 호출 버블이 안 그려지지 않게', () => {
    const projection = new ProjectProjection('p1')
    const frames = projection.onSnapshot(
      snapshot(assistant('t1', '', { kind: 'tool_call', toolName: 'read' })),
    )
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ t: 'delta', p: { messageId: 't1', kind: 'tool_call', append: '' } })
  })

  it('델타를 이어 붙이면 스냅숏의 최종 content 가 된다', () => {
    const projection = new ProjectProjection('p1')
    const steps = ['안', '안녕', '안녕하', '안녕하세요']
    const rebuilt = new Map<string, string>()
    for (const step of steps) {
      for (const frame of projection.onSnapshot(snapshot(assistant('m1', step)))) {
        if (frame.t !== 'delta') throw new Error('delta 가 아니다')
        rebuilt.set(frame.p.messageId, (rebuilt.get(frame.p.messageId) ?? '') + frame.p.append)
      }
    }
    expect(rebuilt.get('m1')).toBe('안녕하세요')
  })

  it('앞부분이 달라지면 델타가 아니라 스냅숏을 통째로 보낸다', () => {
    const projection = new ProjectProjection('p1')
    projection.onSnapshot(snapshot(assistant('m1', '첫 번째 답')))
    const frames = projection.onSnapshot(snapshot(assistant('m1', '다른 답')))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ t: 'snapshot', p: { truncated: false } })
  })

  it('알던 메시지가 사라지면(대화 갈아타기) 스냅숏을 통째로 보낸다', () => {
    const projection = new ProjectProjection('p1')
    projection.onSnapshot(snapshot(assistant('m1', '가'), assistant('m2', '나')))
    const frames = projection.onSnapshot(snapshot(assistant('m3', '새 대화')))
    expect(frames.map((frame) => frame.t)).toEqual(['snapshot'])
  })
})

describe('스냅숏 투영의 상한 (§4-1)', () => {
  it('최근 N 개만 싣고 앞을 자르면 truncated 를 찍는다', () => {
    const projection = new ProjectProjection('p1', { recentMessages: 2, contentBytes: 1024, totalBytes: 1 << 20 })
    const messages = [assistant('m1', '하나'), assistant('m2', '둘'), assistant('m3', '셋')]
    // 앞부분을 바꿔 스냅숏 갈래로 보낸다
    projection.onSnapshot(snapshot(assistant('m1', '하나'), assistant('m2', '둘')))
    const frames = projection.onSnapshot(snapshot(...messages.map((m) => ({ ...m, content: `x${m.content}` }))))
    const frame = frames[0]!
    if (frame.t !== 'snapshot') throw new Error('snapshot 이 아니다')
    expect(frame.p.messages.map((message) => message.id)).toEqual(['m2', 'm3'])
    expect(frame.p.truncated).toBe(true)
  })

  it('메시지당 상한에서 자르고 contentTruncated 를 찍는다', () => {
    const projection = new ProjectProjection('p1', { recentMessages: 50, contentBytes: 10, totalBytes: 1 << 20 })
    projection.onSnapshot(snapshot(assistant('m1', '가나다라마바사')))
    const frames = projection.onSnapshot(snapshot(assistant('m1', '다른 글이다')))
    const frame = frames[0]!
    if (frame.t !== 'snapshot') throw new Error('snapshot 이 아니다')
    expect(frame.p.messages[0]?.contentTruncated).toBe(true)
    // '다른 글' 이 딱 10바이트다 (한글 3 + 3 + 공백 1 + 3) — 여기서 끊어도 글자가 안 깨진다
    expect(frame.p.messages[0]?.content).toBe('다른 글')
  })

  it('cutUtf8 은 글자 경계를 지킨다 — 깨진 글자를 보내지 않는다', () => {
    expect(cutUtf8('가나다', 4)).toBe('가')
    expect(cutUtf8('가나다', 9)).toBe('가나다')
    expect(cutUtf8('abc', 2)).toBe('ab')
  })

  it('기본 상한은 §4-1 의 제안값 + 총합 예산이다', () => {
    expect(DEFAULT_LIMITS).toEqual({ recentMessages: 50, contentBytes: 8192, totalBytes: 131072 })
  })

  it('총합 예산을 넘으면 앞에서부터 버린다 — §2 의 메시지 상한에 걸려 통째로 버려지지 않게', () => {
    const projection = new ProjectProjection('p1', DEFAULT_LIMITS)
    const long = (id: string) => assistant(id, 'a'.repeat(9 * 1024))
    const ids = Array.from({ length: 50 }, (_unused, index) => `m${index}`)
    projection.onSnapshot(snapshot(...ids.map(long)))
    // 앞부분을 바꿔 스냅숏 갈래로 몰아넣는다
    const frames = projection.onSnapshot(snapshot(...ids.map((id) => assistant(id, `b${'a'.repeat(9 * 1024)}`))))
    const frame = frames[0]!
    if (frame.t !== 'snapshot') throw new Error('snapshot 이 아니다')
    expect(frame.p.messages.length).toBeLessThan(50)
    expect(frame.p.truncated).toBe(true)
    // 상한 안에 들어가야 보내진다 (§2: len ≤ 262144)
    expect(new TextEncoder().encode(JSON.stringify(frame)).length).toBeLessThan(262144)
  })
})

describe('턴 이벤트와 대기 목록 (§4-1)', () => {
  it("type:'text' 는 프레임을 만들지 않는다 — 같은 글이 델타로 가므로", () => {
    const projection = new ProjectProjection('p1')
    expect(projection.onTurnEvent({ type: 'text', turnId: 't1', text: '안녕' })).toEqual([])
    expect(projection.onTurnEvent({ type: 'turn_started', turnId: 't1' })).toHaveLength(1)
  })

  it('승인 요청은 turn 과 pending 둘을 낸다 — 인자 전체를 싣는다', () => {
    const projection = new ProjectProjection('p1')
    const frames = projection.onTurnEvent({
      type: 'approval_requested',
      turnId: 't1',
      requestId: 'r1',
      toolName: 'bash',
      args: { command: 'rm -rf /' },
    })
    expect(frames.map((frame) => frame.t)).toEqual(['turn', 'pending'])
    const pending = frames[1]!
    if (pending.t !== 'pending') throw new Error('pending 이 아니다')
    expect(pending.p.items).toEqual([
      { kind: 'approval', turnId: 't1', requestId: 'r1', toolName: 'bash', args: { command: 'rm -rf /' } },
    ])
  })

  it('턴이 끝나면 그 턴의 대기 항목이 사라진다', () => {
    const projection = new ProjectProjection('p1')
    projection.onTurnEvent({ type: 'question_requested', turnId: 't1', questionId: 'q1', question: '갈까?' })
    projection.onTurnEvent({ type: 'plan_requested', turnId: 't2', planId: 'pl1', summary: '계획' })
    const frames = projection.onTurnEvent({ type: 'turn_ended', turnId: 't1', failed: false })
    const pending = frames.find((frame) => frame.t === 'pending')
    if (pending?.t !== 'pending') throw new Error('pending 이 아니다')
    expect(pending.p.items.map((item) => item.kind)).toEqual(['plan'])
  })
})

describe('다시 맞추기 (§2 · §4-2 sync)', () => {
  it('session·snapshot·pending 셋을 낸다 — 링크가 재전송을 안 하는 대신', () => {
    const projection = new ProjectProjection('p1')
    projection.onSessionState({ handshake: { stage: 'ready' }, connection: 'open' })
    projection.onSnapshot(snapshot(assistant('m1', '이미 온 글')))
    projection.onTurnEvent({ type: 'approval_requested', turnId: 't1', requestId: 'r1', toolName: 'read' })

    const frames = projection.resync()
    expect(frames.map((frame) => frame.t)).toEqual(['session', 'snapshot', 'pending'])
    const [session, snap, pending] = frames
    if (session?.t !== 'session' || snap?.t !== 'snapshot' || pending?.t !== 'pending') {
      throw new Error('셋이 아니다')
    }
    expect(session.p).toEqual({ stage: 'ready', connection: 'open' })
    // author·kind 를 기억해 두지 않으면 여기서 전부 assistant/text 로 되살아난다
    expect(snap.p.messages).toEqual([{ id: 'm1', author: 'assistant', kind: 'text', content: '이미 온 글' }])
    expect(pending.p.items).toHaveLength(1)
  })

  it('endpoint 는 싣지 않는다 — 휴대폰에 PC 의 주소를 흘리지 않는다', () => {
    const projection = new ProjectProjection('p1')
    const frames = projection.onSessionState({
      handshake: { stage: 'ready' },
      endpoint: { host: '127.0.0.1', port: 4096, source: 'pool' },
    })
    expect(frames[0]).toEqual({ v: 0, t: 'session', projectId: 'p1', p: { stage: 'ready' } })
  })
})
